import { createHash } from 'crypto';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import EncryptedProfileStorage from '../profile/EncryptedProfileStorage';
import {
	EncryptedProfileConnection,
	encryptedProfileDatabaseName,
} from '../profile/profileStorageTypes';
import VaultCredentialLifecycle from '../vault/VaultCredentialLifecycle';
import { VaultSessionKeyRing } from '../vault/vaultKeyEnvelope';
import VaultKeyEnvelopeStore from '../vault/vaultKeyEnvelopeStore';
import {
	makeEncryptedDesktopDependencies,
} from './makeEncryptedDesktopDependencies';
import { startWatchtowerDesktop } from './startWatchtowerDesktop';
import type { Session } from 'electron';

// cspell:ignore SIGNALAPP sqlcipher

const makeConnection = (events?: string[]): EncryptedProfileConnection => ({
	selectOne: async () => undefined,
	selectAll: async () => [],
	exec: async () => undefined,
	close: async () => {
		events?.push('storage-closed');
	},
	terminate: () => true,
});

describe('makeEncryptedDesktopDependencies', () => {
	const pluginCode = {
		cacheDirectory: 'C:\\WatchtowerPublicCode\\plugins\\cache',
		packageDirectory: 'C:\\WatchtowerPublicCode\\plugins\\packages',
	};
	let vaultDirectory = '';
	const browserSession = {} as Session;

	beforeEach(async () => {
		vaultDirectory = await mkdtemp(join(tmpdir(), 'watchtower-production-bootstrap-'));
	});

	afterEach(async () => {
		await rm(vaultDirectory, { recursive: true, force: true });
	});

	const createCommittedVault = async (
		passphrase: string,
	): Promise<VaultSessionKeyRing> => {
		const credentialLifecycle = new VaultCredentialLifecycle(
			new VaultKeyEnvelopeStore(vaultDirectory),
		);
		const begun = await credentialLifecycle.beginCreate({
			passphrase,
			memoryProfile: 'qualified-constrained',
		});
		if (begun.kind !== 'recoveryConfirmationRequired') {
			throw new Error('Expected vault creation to begin');
		}
		const created = await credentialLifecycle.confirmCreate({
			creationId: begun.creationId,
			recoverySecret: begun.recoverySecret,
		});
		if (created.kind !== 'opened') throw new Error('Expected vault creation');
		return created.keyRing;
	};

	test('consumes the credential instead of retaining it in desktop dependencies', () => {
		const command = {
			kind: 'unlock' as const,
			passphrase: 'transient private atlas words',
		};

		const dependencies = makeEncryptedDesktopDependencies({
			command,
			databasePath: join(vaultDirectory, 'profile.sqlite'),
			envelopeDirectory: vaultDirectory,
			openProfileStorage: async () => new EncryptedProfileStorage(makeConnection()),
			profileHostOptions: {
				pluginCode,
				ephemeralSessionFactory: {
					fromPartition: async () => ({
						browserSession,
						storagePath: null,
						clearCache: async () => {},
						clearStorageData: async () => {},
						closeAllConnections: async () => {},
					}),
				},
				publicVaultLockFilePath: 'C:\\WatchtowerPublicRuntime\\vault.lock',
				resourceDirectory: 'C:\\WatchtowerVirtualProfile\\resources',
			},
			loadJoplinProfileRuntime: async () => ({
				start: async () => {},
				stop: async () => ({ kind: 'stopped' }),
				terminate: () => true,
			}),
		});

		expect(command.passphrase).toBe('');
		expect(dependencies.options).toEqual({
			operationTimeoutMs: 60_000,
			profileStartTimeoutMs: 120_000,
		});
	});

	test('creates the first vault only after the user confirms its recovery secret', async () => {
		let displayedRecoverySecret = '';
		const command = {
			kind: 'create' as const,
			passphrase: 'first private atlas notebook words',
			confirmRecoverySecret: async (recoverySecret: string) => {
				displayedRecoverySecret = recoverySecret;
				return recoverySecret;
			},
		};
		const started = await startWatchtowerDesktop(makeEncryptedDesktopDependencies({
			command,
			databasePath: join(vaultDirectory, 'profile.sqlite'),
			envelopeDirectory: vaultDirectory,
			openProfileStorage: async () => new EncryptedProfileStorage(makeConnection()),
			profileHostOptions: {
				pluginCode,
				ephemeralSessionFactory: {
					fromPartition: async () => ({
						browserSession,
						storagePath: null,
						clearCache: async () => {},
						clearStorageData: async () => {},
						closeAllConnections: async () => {},
					}),
				},
				publicVaultLockFilePath: 'C:\\WatchtowerPublicRuntime\\vault.lock',
				resourceDirectory: 'C:\\WatchtowerVirtualProfile\\resources',
			},
			loadJoplinProfileRuntime: async () => ({
				start: async () => {},
				stop: async () => ({ kind: 'stopped' }),
				terminate: () => true,
			}),
		}));

		expect(started.result).toEqual({ kind: 'unlocked' });
		expect(displayedRecoverySecret).toMatch(/^WT1-/);
		expect(command.passphrase).toBe('');
		await started.lifecycle.end('close');
	}, 90_000);

	test('recovers the existing encrypted profile while replacing the lost passphrase', async () => {
		const credentialLifecycle = new VaultCredentialLifecycle(
			new VaultKeyEnvelopeStore(vaultDirectory),
		);
		const begun = await credentialLifecycle.beginCreate({
			passphrase: 'lost private atlas words',
			memoryProfile: 'qualified-constrained',
		});
		if (begun.kind !== 'recoveryConfirmationRequired') {
			throw new Error('Expected vault creation to begin');
		}
		const recoverySecret = begun.recoverySecret;
		const created = await credentialLifecycle.confirmCreate({
			creationId: begun.creationId,
			recoverySecret,
		});
		if (created.kind !== 'opened') throw new Error('Expected vault creation');
		created.keyRing.dispose();

		const command = {
			kind: 'recover' as const,
			recoverySecret,
			newPassphrase: 'replacement private atlas notebook words',
		};
		const started = await startWatchtowerDesktop(makeEncryptedDesktopDependencies({
			command,
			databasePath: join(vaultDirectory, 'profile.sqlite'),
			envelopeDirectory: vaultDirectory,
			openProfileStorage: async () => new EncryptedProfileStorage(makeConnection()),
			profileHostOptions: {
				pluginCode,
				ephemeralSessionFactory: {
					fromPartition: async () => ({
						browserSession,
						storagePath: null,
						clearCache: async () => {},
						clearStorageData: async () => {},
						closeAllConnections: async () => {},
					}),
				},
				publicVaultLockFilePath: 'C:\\WatchtowerPublicRuntime\\vault.lock',
				resourceDirectory: 'C:\\WatchtowerVirtualProfile\\resources',
			},
			loadJoplinProfileRuntime: async () => ({
				start: async () => {},
				stop: async () => ({ kind: 'stopped' }),
				terminate: () => true,
			}),
		}));

		expect(started.result).toEqual({ kind: 'unlocked' });
		expect(command.recoverySecret).toBe('');
		expect(command.newPassphrase).toBe('');
		await started.lifecycle.end('close');
		await expect(credentialLifecycle.unlockWithPassphrase(
			'lost private atlas words',
		)).resolves.toEqual({ kind: 'rejected', reason: 'wrongCredential' });
		const replacement = await credentialLifecycle.unlockWithPassphrase(
			'replacement private atlas notebook words',
		);
		expect(replacement.kind).toBe('opened');
		if (replacement.kind === 'opened') replacement.keyRing.dispose();
	}, 90_000);

	test('changes the passphrase without replacing the encrypted profile', async () => {
		const currentPassphrase = 'current private atlas notebook words';
		const createdKeyRing = await createCommittedVault(currentPassphrase);
		const expectedFingerprint = await createdKeyRing.withDerivedKey(
			'sqlcipher',
			key => createHash('sha256').update(key).digest('hex'),
		);
		createdKeyRing.dispose();
		let openedFingerprint = '';
		const command = {
			kind: 'changePassphrase' as const,
			currentPassphrase,
			newPassphrase: 'rotated private atlas notebook words',
		};
		const started = await startWatchtowerDesktop(makeEncryptedDesktopDependencies({
			command,
			databasePath: join(vaultDirectory, 'profile.sqlite'),
			envelopeDirectory: vaultDirectory,
			openProfileStorage: async keyRing => {
				openedFingerprint = await keyRing.withDerivedKey(
					'sqlcipher',
					key => createHash('sha256').update(key).digest('hex'),
				);
				return new EncryptedProfileStorage(makeConnection());
			},
			profileHostOptions: {
				pluginCode,
				ephemeralSessionFactory: {
					fromPartition: async () => ({
						browserSession,
						storagePath: null,
						clearCache: async () => {},
						clearStorageData: async () => {},
						closeAllConnections: async () => {},
					}),
				},
				publicVaultLockFilePath: 'C:\\WatchtowerPublicRuntime\\vault.lock',
				resourceDirectory: 'C:\\WatchtowerVirtualProfile\\resources',
			},
			loadJoplinProfileRuntime: async () => ({
				start: async () => {},
				stop: async () => ({ kind: 'stopped' }),
				terminate: () => true,
			}),
		}));

		expect(started.result).toEqual({ kind: 'unlocked' });
		expect(openedFingerprint).toBe(expectedFingerprint);
		expect(command.currentPassphrase).toBe('');
		expect(command.newPassphrase).toBe('');
		await started.lifecycle.end('close');
		const credentialLifecycle = new VaultCredentialLifecycle(
			new VaultKeyEnvelopeStore(vaultDirectory),
		);
		await expect(credentialLifecycle.unlockWithPassphrase(
			currentPassphrase,
		)).resolves.toEqual({ kind: 'rejected', reason: 'wrongCredential' });
		const rotated = await credentialLifecycle.unlockWithPassphrase(
			'rotated private atlas notebook words',
		);
		expect(rotated.kind).toBe('opened');
		if (rotated.kind === 'opened') rotated.keyRing.dispose();
	}, 90_000);

	test('replaces and confirms the Recovery Secret without changing profile keys', async () => {
		const passphrase = 'replacement authorization private atlas words';
		const credentialLifecycle = new VaultCredentialLifecycle(
			new VaultKeyEnvelopeStore(vaultDirectory),
		);
		const begun = await credentialLifecycle.beginCreate({
			passphrase,
			memoryProfile: 'qualified-constrained',
		});
		if (begun.kind !== 'recoveryConfirmationRequired') {
			throw new Error('Expected vault creation to begin');
		}
		const oldRecoverySecret = begun.recoverySecret;
		const created = await credentialLifecycle.confirmCreate({
			creationId: begun.creationId,
			recoverySecret: oldRecoverySecret,
		});
		if (created.kind !== 'opened') throw new Error('Expected vault creation');
		const expectedFingerprint = await created.keyRing.withDerivedKey(
			'sqlcipher',
			key => createHash('sha256').update(key).digest('hex'),
		);
		created.keyRing.dispose();

		let displayedRecoverySecret = '';
		let openedFingerprint = '';
		const command = {
			kind: 'replaceRecoverySecret' as const,
			passphrase,
			confirmRecoverySecret: async (recoverySecret: string) => {
				displayedRecoverySecret = recoverySecret;
				return recoverySecret;
			},
		};
		const started = await startWatchtowerDesktop(makeEncryptedDesktopDependencies({
			command,
			databasePath: join(vaultDirectory, 'profile.sqlite'),
			envelopeDirectory: vaultDirectory,
			openProfileStorage: async keyRing => {
				openedFingerprint = await keyRing.withDerivedKey(
					'sqlcipher',
					key => createHash('sha256').update(key).digest('hex'),
				);
				return new EncryptedProfileStorage(makeConnection());
			},
			profileHostOptions: {
				pluginCode,
				ephemeralSessionFactory: {
					fromPartition: async () => ({
						browserSession,
						storagePath: null,
						clearCache: async () => {},
						clearStorageData: async () => {},
						closeAllConnections: async () => {},
					}),
				},
				publicVaultLockFilePath: 'C:\\WatchtowerPublicRuntime\\vault.lock',
				resourceDirectory: 'C:\\WatchtowerVirtualProfile\\resources',
			},
			loadJoplinProfileRuntime: async () => ({
				start: async () => {},
				stop: async () => ({ kind: 'stopped' }),
				terminate: () => true,
			}),
		}));

		expect(started.result).toEqual({ kind: 'unlocked' });
		expect(openedFingerprint).toBe(expectedFingerprint);
		expect(displayedRecoverySecret).toMatch(/^WT1-/);
		expect(displayedRecoverySecret).not.toBe(oldRecoverySecret);
		expect(command.passphrase).toBe('');
		await started.lifecycle.end('close');
		await expect(credentialLifecycle.recoverWithRecoverySecret({
			recoverySecret: oldRecoverySecret,
			newPassphrase: 'unused replacement private atlas words',
			memoryProfile: 'qualified-constrained',
		})).resolves.toEqual({ kind: 'rejected', reason: 'wrongCredential' });
	}, 90_000);

	test('unlocks encrypted storage before loading Joplin and rejects plaintext fallback', async () => {
		const passphrase = 'production private atlas words';
		const createdKeyRing = await createCommittedVault(passphrase);
		const expectedFingerprint = await createdKeyRing.withDerivedKey(
			'sqlcipher',
			key => createHash('sha256').update(key).digest('hex'),
		);
		createdKeyRing.dispose();

		const events: string[] = [];
		let activeKeyRing: VaultSessionKeyRing|undefined;
		const makeDependencies = (candidatePassphrase: string) =>
			makeEncryptedDesktopDependencies({
				command: { kind: 'unlock', passphrase: candidatePassphrase },
				databasePath: join(vaultDirectory, 'profile.sqlite'),
				envelopeDirectory: vaultDirectory,
				openProfileStorage: async keyRing => {
					activeKeyRing = keyRing;
					events.push(await keyRing.withDerivedKey(
						'sqlcipher',
						key => `storage:${createHash('sha256').update(key).digest('hex')}`,
					));
					return new EncryptedProfileStorage(makeConnection(events));
				},
				profileHostOptions: {
					pluginCode,
					ephemeralSessionFactory: {
						fromPartition: async () => ({
							browserSession,
							storagePath: null,
							clearCache: async () => {},
							clearStorageData: async () => {},
							closeAllConnections: async () => {},
						}),
					},
					publicVaultLockFilePath: 'C:\\WatchtowerPublicRuntime\\vault.lock',
					resourceDirectory: 'C:\\WatchtowerVirtualProfile\\resources',
				},
				loadJoplinProfileRuntime: async () => {
					events.push('joplin-loaded');
					return {
						start: async () => {
							events.push('joplin-started');
						},
						stop: async () => {
							events.push('joplin-stopped');
							return { kind: 'stopped' };
						},
						terminate: () => true,
					};
				},
			});

		const unlocked = await startWatchtowerDesktop(makeDependencies(passphrase));
		expect(unlocked.result).toEqual({ kind: 'unlocked' });
		expect(events).toEqual([
			`storage:${expectedFingerprint}`,
			'joplin-loaded',
			'joplin-started',
		]);
		await unlocked.lifecycle.end('close');
		expect(events.slice(-2)).toEqual([
			'joplin-stopped',
			'storage-closed',
		]);
		await expect(activeKeyRing!.withDerivedKey(
			'sqlcipher',
			key => key.byteLength,
		)).rejects.toThrow('disposed');

		events.length = 0;
		const rejected = await startWatchtowerDesktop(
			makeDependencies('incorrect private atlas words'),
		);
		expect(rejected.result).toEqual({
			kind: 'rejected',
			reason: 'wrongCredential',
		});
		expect(events).toEqual([]);
	}, 30_000);

	test('cancels passphrase unlock before opening profile storage or loading Joplin', async () => {
		const passphrase = 'cancelled private atlas words';
		const createdKeyRing = await createCommittedVault(passphrase);
		createdKeyRing.dispose();
		const openProfileStorage = jest.fn(
			async () => new EncryptedProfileStorage(makeConnection()),
		);
		const loadJoplinProfileRuntime = jest.fn(async () => ({
			start: async () => {},
			stop: async () => ({ kind: 'stopped' as const }),
			terminate: () => true,
		}));
		const controller = new AbortController();

		const starting = startWatchtowerDesktop(
			makeEncryptedDesktopDependencies({
				command: { kind: 'unlock', passphrase },
				databasePath: join(vaultDirectory, 'profile.sqlite'),
				envelopeDirectory: vaultDirectory,
				openProfileStorage,
				profileHostOptions: {
					pluginCode,
					ephemeralSessionFactory: {
						fromPartition: async () => ({
							browserSession,
							storagePath: null,
							clearCache: async () => {},
							clearStorageData: async () => {},
							closeAllConnections: async () => {},
						}),
					},
					publicVaultLockFilePath: 'C:\\WatchtowerPublicRuntime\\vault.lock',
					resourceDirectory: 'C:\\WatchtowerVirtualProfile\\resources',
				},
				loadJoplinProfileRuntime,
			}),
			controller.signal,
		);
		setTimeout(() => controller.abort(), 0);

		await expect(starting).resolves.toMatchObject({
			result: { kind: 'rejected', reason: 'cancelled' },
		});
		expect(openProfileStorage).not.toHaveBeenCalled();
		expect(loadJoplinProfileRuntime).not.toHaveBeenCalled();
	}, 30_000);

	const sqlCipherTest = process.env.WATCHTOWER_SQLCIPHER_PREBUILD_ROOT ?
		test :
		test.skip;
	sqlCipherTest('opens the production SQLCipher profile through desktop bootstrap', async () => {
		process.env['@SIGNALAPP/SQLCIPHER_PREBUILD'] =
			process.env.WATCHTOWER_SQLCIPHER_PREBUILD_ROOT;
		const passphrase = 'production sqlcipher atlas words';
		const createdKeyRing = await createCommittedVault(passphrase);
		createdKeyRing.dispose();

		const started = await startWatchtowerDesktop(
			makeEncryptedDesktopDependencies({
				command: { kind: 'unlock', passphrase },
				databasePath: join(vaultDirectory, 'profile.sqlite'),
				envelopeDirectory: vaultDirectory,
				profileHostOptions: {
					pluginCode,
					ephemeralSessionFactory: {
						fromPartition: async () => ({
							browserSession,
							storagePath: null,
							clearCache: async () => {},
							clearStorageData: async () => {},
							closeAllConnections: async () => {},
						}),
					},
					publicVaultLockFilePath: 'C:\\WatchtowerPublicRuntime\\vault.lock',
					resourceDirectory: 'C:\\WatchtowerVirtualProfile\\resources',
				},
				loadJoplinProfileRuntime: async () => ({
					start: async profile => {
						await profile.database.open({
							name: encryptedProfileDatabaseName,
						});
						await profile.database.exec(
							'CREATE TABLE bootstrap_proof (content TEXT NOT NULL)',
						);
						await profile.database.exec(
							'INSERT INTO bootstrap_proof (content) VALUES (?)',
							['encrypted-bootstrap-canary'],
						);
						await expect(profile.database.selectOne(
							'SELECT content FROM bootstrap_proof',
						)).resolves.toEqual({
							content: 'encrypted-bootstrap-canary',
						});
					},
					stop: async () => ({ kind: 'stopped' }),
					terminate: () => true,
				}),
			}),
		);

		expect(started.result).toEqual({ kind: 'unlocked' });
		await expect(started.lifecycle.end('close')).resolves.toEqual({
			kind: 'locked',
		});
	}, 30_000);
});
