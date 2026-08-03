import type {
	ProfileHost,
	VaultAccessAdapter,
	VaultOpenHandle,
} from '../vault/PreProfileVaultBootstrap';
import type {
	EncryptedDesktopCommand,
} from './makeEncryptedDesktopDependencies';
import runPreProfileUnlockFlow from './runPreProfileUnlockFlow';
import type { PreProfileUnlockView } from './runPreProfileUnlockFlow';
import { startWatchtowerDesktop } from './startWatchtowerDesktop';
import type { WatchtowerDesktopStart } from './startWatchtowerDesktop';

describe('runPreProfileUnlockFlow', () => {
	const activeSignal = () => new AbortController().signal;
	const openHandle: VaultOpenHandle = {
		close: async () => {},
		terminate: () => true,
	};

	const makeAttempt = (
		profileStarts: string[],
		commands: EncryptedDesktopCommand[],
	) => async (
		command: EncryptedDesktopCommand,
		signal: AbortSignal,
	): Promise<WatchtowerDesktopStart> => {
		commands.push(command);
		const accessAdapter: VaultAccessAdapter = {
			create: jest.fn(),
			unlock: async () => command.kind !== 'recover' && command.kind !== 'changePassphrase' &&
				command.passphrase === 'correct private atlas words' ?
				{ kind: 'opened', handle: openHandle } :
				{ kind: 'rejected', reason: 'wrongCredential' },
			recover: jest.fn(),
			abort: () => true,
		};
		const profileHost: ProfileHost = {
			start: async () => {
				profileStarts.push('joplin-started');
			},
			stop: async () => ({ kind: 'stopped' }),
			terminate: () => true,
		};

		return startWatchtowerDesktop({
			operation: 'unlock',
			accessAdapter,
			profileHost,
		}, signal);
	};

	test('retries a wrong credential without starting Joplin and clears each submission', async () => {
		const feedback: unknown[] = [];
		const submissions = [
			{
				kind: 'submitted' as const,
				passphrase: 'wrong private atlas words',
				signal: activeSignal(),
			},
			{
				kind: 'submitted' as const,
				passphrase: 'correct private atlas words',
				signal: activeSignal(),
			},
		];
		const view: PreProfileUnlockView = {
			requestPassphrase: async currentFeedback => {
				feedback.push(currentFeedback);
				return submissions.shift()!;
			},
			close: jest.fn(),
		};
		const commands: EncryptedDesktopCommand[] = [];
		const profileStarts: string[] = [];

		const result = await runPreProfileUnlockFlow(
			view,
			makeAttempt(profileStarts, commands),
		);

		expect(result.kind).toBe('unlocked');
		expect(profileStarts).toEqual(['joplin-started']);
		expect(feedback).toEqual([
			undefined,
			{ kind: 'wrongCredential' },
		]);
		expect(commands).toHaveLength(2);
		expect(commands.every(command => (
			command.kind !== 'recover' && command.kind !== 'changePassphrase' &&
			command.passphrase === ''
		))).toBe(true);
		expect(view.close).toHaveBeenCalledTimes(1);
	});

	test('cancellation closes the pre-profile view without attempting vault access', async () => {
		const view: PreProfileUnlockView = {
			requestPassphrase: async () => ({ kind: 'cancelled' }),
			close: jest.fn(),
		};
		const startAttempt = jest.fn();

		const result = await runPreProfileUnlockFlow(view, startAttempt);

		expect(result).toEqual({ kind: 'cancelled' });
		expect(startAttempt).not.toHaveBeenCalled();
		expect(view.close).toHaveBeenCalledTimes(1);
	});

	test('hands recovery credentials to one attempt and clears both values', async () => {
		const submission = {
			kind: 'submitted' as const,
			operation: 'recover' as const,
			recoverySecret: 'WT1-RECOVERY-SECRET',
			newPassphrase: 'replacement private atlas words',
			signal: activeSignal(),
		};
		const view: PreProfileUnlockView = {
			requestPassphrase: async () => submission,
			close: jest.fn(),
		};
		const received: EncryptedDesktopCommand[] = [];
		const startAttempt = jest.fn(async (command: EncryptedDesktopCommand) => {
			received.push(command);
			return {
				lifecycle: undefined as never,
				result: { kind: 'unlocked' as const },
			};
		});

		await expect(runPreProfileUnlockFlow(view, startAttempt)).resolves.toEqual({
			kind: 'unlocked',
			lifecycle: undefined,
		});
		expect(received).toHaveLength(1);
		expect(received[0]).toMatchObject({
			kind: 'recover',
			recoverySecret: '',
			newPassphrase: '',
		});
	});

	test('hands passphrase rotation credentials to one attempt and clears both values', async () => {
		const submission = {
			kind: 'submitted' as const,
			operation: 'changePassphrase' as const,
			currentPassphrase: 'current private atlas words',
			newPassphrase: 'replacement private atlas words',
			signal: activeSignal(),
		};
		const view: PreProfileUnlockView = {
			requestPassphrase: async () => submission,
			close: jest.fn(),
		};
		const received: EncryptedDesktopCommand[] = [];
		const startAttempt = jest.fn(async (command: EncryptedDesktopCommand) => {
			received.push(command);
			return {
				lifecycle: undefined as never,
				result: { kind: 'unlocked' as const },
			};
		});

		await runPreProfileUnlockFlow(view, startAttempt);
		expect(received).toHaveLength(1);
		expect(received[0]).toMatchObject({
			kind: 'changePassphrase',
			currentPassphrase: '',
			newPassphrase: '',
		});
	});

	test('authorizes Recovery Secret replacement and clears the passphrase', async () => {
		const submission = {
			kind: 'submitted' as const,
			operation: 'replaceRecoverySecret' as const,
			passphrase: 'current private atlas words',
			signal: activeSignal(),
		};
		const view: PreProfileUnlockView = {
			requestPassphrase: async () => submission,
			confirmRecoverySecret: async recoverySecret => recoverySecret,
			close: jest.fn(),
		};
		const received: EncryptedDesktopCommand[] = [];
		const startAttempt = jest.fn(async (command: EncryptedDesktopCommand) => {
			received.push(command);
			return {
				lifecycle: undefined as never,
				result: { kind: 'unlocked' as const },
			};
		});

		await runPreProfileUnlockFlow(view, startAttempt);
		expect(received).toHaveLength(1);
		expect(received[0]).toMatchObject({
			kind: 'replaceRecoverySecret',
			passphrase: '',
		});
	});

	test('a corrupt vault is terminal and exposes only the opaque start result', async () => {
		const submission = {
			kind: 'submitted' as const,
			passphrase: 'private atlas words',
			signal: activeSignal(),
		};
		const view: PreProfileUnlockView = {
			requestPassphrase: jest.fn(async () => submission),
			close: jest.fn(),
		};
		const startAttempt = jest.fn(async () => ({
			lifecycle: undefined as never,
			result: {
				kind: 'failedClosed' as const,
				stage: 'vaultAccess' as const,
				reason: 'corruptVault' as const,
			},
		}));

		const result = await runPreProfileUnlockFlow(view, startAttempt);

		expect(result).toEqual({
			kind: 'failedClosed',
			stage: 'vaultAccess',
			reason: 'corruptVault',
		});
		expect(submission.passphrase).toBe('');
		expect(view.requestPassphrase).toHaveBeenCalledTimes(1);
		expect(view.close).toHaveBeenCalledTimes(1);
	});

	test('closes an unlocked profile before surfacing unlock-view cleanup failure', async () => {
		const closeVault = jest.fn(async () => {});
		const stopProfile = jest.fn(async () => ({ kind: 'stopped' as const }));
		const view: PreProfileUnlockView = {
			requestPassphrase: async () => ({
				kind: 'submitted',
				passphrase: 'correct private atlas words',
				signal: activeSignal(),
			}),
			close: async () => {
				throw new Error('unlock view cleanup failed');
			},
		};
		const startAttempt = async (
			_command: EncryptedDesktopCommand,
			signal: AbortSignal,
		) => await startWatchtowerDesktop({
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
				start: async () => {},
				stop: stopProfile,
				terminate: () => true,
			},
		}, signal);

		await expect(runPreProfileUnlockFlow(view, startAttempt)).rejects.toThrow(
			'unlock view cleanup failed',
		);
		expect(stopProfile).toHaveBeenCalledWith('close', expect.any(AbortSignal));
		expect(closeVault).toHaveBeenCalledTimes(1);
	});

	test('normalizes cancellation during an active unlock attempt', async () => {
		const controller = new AbortController();
		const view: PreProfileUnlockView = {
			requestPassphrase: async () => ({
				kind: 'submitted',
				passphrase: 'private atlas words',
				signal: controller.signal,
			}),
			close: jest.fn(),
		};
		const startAttempt = async (
			_command: EncryptedDesktopCommand,
			signal: AbortSignal,
		) => {
			controller.abort();
			return startWatchtowerDesktop({
				operation: 'unlock',
				accessAdapter: {
					create: jest.fn(),
					unlock: async () => ({ kind: 'rejected', reason: 'wrongCredential' }),
					recover: jest.fn(),
					abort: () => true,
				},
				profileHost: {
					start: jest.fn(),
					stop: jest.fn(),
					terminate: () => true,
				},
			}, signal);
		};

		await expect(runPreProfileUnlockFlow(view, startAttempt)).resolves.toEqual({
			kind: 'cancelled',
		});
		expect(view.close).toHaveBeenCalledTimes(1);
	});
});
