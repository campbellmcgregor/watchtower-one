import { join } from 'path';
import type {
	ProfileHost,
	VaultAccessAdapter,
	VaultOpenHandle,
} from '../vault/PreProfileVaultBootstrap';
import type {
	EphemeralElectronSessionFactory,
} from '../profile/ephemeralProfileRuntimeTypes';
import type { PreProfileUnlockView } from './runPreProfileUnlockFlow';
import runWatchtowerElectronMain from './runWatchtowerElectronMain';
import type {
	EncryptedDesktopDependencyOptions,
} from './makeEncryptedDesktopDependencies';
import type { WatchtowerDesktopDependencies } from './startWatchtowerDesktop';

// cspell:ignore handoff

describe('runWatchtowerElectronMain', () => {
	let registeredCloseProfile: (()=> Promise<void>)|undefined;
	const applicationDataDirectory = 'C:\\Users\\Alice\\AppData\\Roaming';
	const userDataDirectory = join(applicationDataDirectory, 'Watchtower One');
	const vaultDirectory = join(userDataDirectory, 'vault');
	const publicRuntimeDirectory = join(userDataDirectory, 'runtime');
	const publicVaultLockFilePath = join(publicRuntimeDirectory, 'vault.lock');
	const publicPluginCodeDirectory = join(userDataDirectory, 'code', 'plugins');
	const unlockAssetDirectory = 'C:\\Watchtower\\unlock';
	const sessionFactory = {} as EphemeralElectronSessionFactory;
	const openHandle: VaultOpenHandle = {
		close: async () => {},
		terminate: () => true,
	};

	const unlockedDependencies = (events: string[]): WatchtowerDesktopDependencies => {
		const accessAdapter: VaultAccessAdapter = {
			create: jest.fn(),
			unlock: async () => {
				events.push('vault-opened');
				return { kind: 'opened', handle: openHandle };
			},
			recover: jest.fn(),
			abort: () => true,
		};
		const profileHost: ProfileHost = {
			start: async () => {
				events.push('joplin-started');
			},
			stop: async () => {
				events.push('joplin-stopped');
				return { kind: 'stopped' };
			},
			terminate: () => true,
		};
		return {
			operation: 'unlock',
			accessAdapter,
			profileHost,
		};
	};

	const host = (
		events: string[],
		view: PreProfileUnlockView,
	) => ({
		prepareBeforeReady: () => {
			events.push('protocols-registered');
		},
		registerProfileCloseHandler: (closeProfile: ()=> Promise<void>) => {
			events.push('profile-close-handler-registered');
			registeredCloseProfile = closeProfile;
		},
		applicationDataDirectory: () => applicationDataDirectory,
		ensureDirectory: (path: string) => {
			events.push(`directory-created:${path}`);
		},
		setUserDataDirectory: (path: string) => {
			events.push(`user-data-assigned:${path}`);
		},
		waitUntilReady: async () => {
			events.push('electron-ready');
		},
		createUnlockView: async (assetDirectory: string) => {
			events.push(`unlock-view-created:${assetDirectory}`);
			return view;
		},
		quit: (exitCode: 0|1) => {
			events.push(`quit:${exitCode}`);
		},
	});

	test('assigns a dedicated Watchtower root before Electron readiness and encrypted profile startup', async () => {
		registeredCloseProfile = undefined;
		const events: string[] = [];
		const submission = {
			kind: 'submitted' as const,
			passphrase: 'private atlas words',
			signal: new AbortController().signal,
		};
		const view: PreProfileUnlockView = {
			requestPassphrase: async () => {
				events.push('credential-submitted');
				return submission;
			},
			close: async () => {
				events.push('unlock-view-closed');
			},
		};
		let receivedOptions: EncryptedDesktopDependencyOptions|undefined;
		const runtime = {
			start: async () => {},
			stop: async () => ({ kind: 'stopped' as const }),
			terminate: () => true,
		};

		const result = await runWatchtowerElectronMain({
			host: host(events, view),
			unlockAssetDirectory,
			ephemeralSessionFactory: sessionFactory,
			loadJoplinProfileRuntime: async () => runtime,
			makeEncryptedDesktopDependencies: options => {
				receivedOptions = options;
				events.push(`credential-received:${options.command.passphrase}`);
				return unlockedDependencies(events);
			},
		});

		expect(result.kind).toBe('unlocked');
		expect(events).toEqual([
			'protocols-registered',
			`directory-created:${userDataDirectory}`,
			`directory-created:${publicRuntimeDirectory}`,
			`user-data-assigned:${userDataDirectory}`,
			'electron-ready',
			`unlock-view-created:${unlockAssetDirectory}`,
			'credential-submitted',
			'credential-received:private atlas words',
			'vault-opened',
			'joplin-started',
			'unlock-view-closed',
			'profile-close-handler-registered',
		]);
		expect(receivedOptions).toMatchObject({
			databasePath: join(vaultDirectory, 'profile.sqlite'),
			envelopeDirectory: join(vaultDirectory, 'envelope'),
			profileHostOptions: {
				ephemeralSessionFactory: sessionFactory,
				pluginCode: {
					cacheDirectory: join(publicPluginCodeDirectory, 'cache'),
					packageDirectory: join(publicPluginCodeDirectory, 'packages'),
				},
				publicVaultLockFilePath,
				resourceDirectory: join(vaultDirectory, 'resource-virtual'),
			},
		});
		await expect(receivedOptions!.loadJoplinProfileRuntime()).resolves.toBe(runtime);
		expect(submission.passphrase).toBe('');
		await registeredCloseProfile!();
		expect(events.at(-1)).toBe('joplin-stopped');
	});

	test('cancellation before submission closes the view and quits cleanly', async () => {
		const events: string[] = [];
		const makeEncryptedDesktopDependencies = jest.fn();

		await expect(runWatchtowerElectronMain({
			host: host(events, {
				requestPassphrase: async () => ({ kind: 'cancelled' }),
				close: async () => {},
			}),
			unlockAssetDirectory,
			ephemeralSessionFactory: sessionFactory,
			makeEncryptedDesktopDependencies,
		})).resolves.toEqual({ kind: 'cancelled' });

		expect(makeEncryptedDesktopDependencies).not.toHaveBeenCalled();
		expect(events.at(-1)).toBe('quit:0');
	});

	test('cancellation during dependency-backed unlock also quits cleanly', async () => {
		const events: string[] = [];
		const controller = new AbortController();

		await expect(runWatchtowerElectronMain({
			host: host(events, {
				requestPassphrase: async () => ({
					kind: 'submitted',
					passphrase: 'private atlas words',
					signal: controller.signal,
				}),
				close: async () => {},
			}),
			unlockAssetDirectory,
			ephemeralSessionFactory: sessionFactory,
			makeEncryptedDesktopDependencies: () => ({
				operation: 'unlock',
				accessAdapter: {
					create: jest.fn(),
					unlock: async () => {
						controller.abort();
						return { kind: 'rejected', reason: 'wrongCredential' };
					},
					recover: jest.fn(),
					abort: () => true,
				},
				profileHost: {
					start: jest.fn(),
					stop: jest.fn(),
					terminate: () => true,
				},
			}),
		})).resolves.toEqual({ kind: 'cancelled' });

		expect(events.at(-1)).toBe('quit:0');
	});

	test('closes encrypted storage and quits failed closed when Joplin runtime loading fails', async () => {
		const events: string[] = [];
		const closeVault = jest.fn(async () => {});

		await expect(runWatchtowerElectronMain({
			host: host(events, {
				requestPassphrase: async () => ({
					kind: 'submitted',
					passphrase: 'private atlas words',
					signal: new AbortController().signal,
				}),
				close: async () => {},
			}),
			unlockAssetDirectory,
			ephemeralSessionFactory: sessionFactory,
			loadJoplinProfileRuntime: async () => {
				throw new Error('Joplin runtime load failed');
			},
			makeEncryptedDesktopDependencies: options => ({
				operation: 'unlock',
				accessAdapter: {
					create: jest.fn(),
					unlock: async () => ({
						kind: 'opened',
						handle: {
							close: closeVault,
							terminate: () => true,
						},
					}),
					recover: jest.fn(),
					abort: () => true,
				},
				profileHost: {
					start: async () => {
						await options.loadJoplinProfileRuntime();
					},
					stop: jest.fn(),
					terminate: () => true,
				},
			}),
		})).resolves.toEqual({
			kind: 'failedClosed',
			stage: 'profileStart',
		});

		expect(closeVault).toHaveBeenCalledTimes(1);
		expect(events.at(-1)).toBe('quit:1');
	});

	test('quits failed closed when the dedicated user-data root cannot be prepared', async () => {
		const events: string[] = [];
		const electronHost = host(events, {
			requestPassphrase: async () => ({ kind: 'cancelled' }),
			close: async () => {},
		});
		electronHost.ensureDirectory = () => {
			throw new Error('public bootstrap root unavailable');
		};

		await expect(runWatchtowerElectronMain({
			host: electronHost,
			unlockAssetDirectory,
			ephemeralSessionFactory: sessionFactory,
			makeEncryptedDesktopDependencies: jest.fn(),
		})).rejects.toThrow('public bootstrap root unavailable');

		expect(events.at(-1)).toBe('quit:1');
		expect(events[0]).toBe('protocols-registered');
		expect(events).not.toContain('electron-ready');
	});
});
