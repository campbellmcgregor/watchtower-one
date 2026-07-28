import type {
	ProfileHost,
	VaultAccessAdapter,
	VaultOpenHandle,
} from '../vault/PreProfileVaultBootstrap';
import type {
	EncryptedDesktopUnlockCommand,
} from './makeEncryptedDesktopDependencies';
import runPreProfileUnlockFlow from './runPreProfileUnlockFlow';
import type { PreProfileUnlockView } from './runPreProfileUnlockFlow';
import { startWatchtowerDesktop } from './startWatchtowerDesktop';
import type { WatchtowerDesktopStart } from './startWatchtowerDesktop';

describe('runPreProfileUnlockFlow', () => {
	const openHandle: VaultOpenHandle = {
		close: async () => {},
		terminate: () => true,
	};

	const makeAttempt = (
		profileStarts: string[],
		commands: EncryptedDesktopUnlockCommand[],
	) => async (
		command: EncryptedDesktopUnlockCommand,
	): Promise<WatchtowerDesktopStart> => {
		commands.push(command);
		const accessAdapter: VaultAccessAdapter = {
			create: jest.fn(),
			unlock: async () => command.passphrase === 'correct private atlas words' ?
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
		});
	};

	test('retries a wrong credential without starting Joplin and clears each submission', async () => {
		const feedback: unknown[] = [];
		const submissions = [
			{ kind: 'submitted' as const, passphrase: 'wrong private atlas words' },
			{ kind: 'submitted' as const, passphrase: 'correct private atlas words' },
		];
		const view: PreProfileUnlockView = {
			requestPassphrase: async currentFeedback => {
				feedback.push(currentFeedback);
				return submissions.shift()!;
			},
			close: jest.fn(),
		};
		const commands: EncryptedDesktopUnlockCommand[] = [];
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
		expect(commands.every(command => command.passphrase === '')).toBe(true);
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

	test('a corrupt vault is terminal and exposes only the opaque start result', async () => {
		const submission = {
			kind: 'submitted' as const,
			passphrase: 'private atlas words',
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
});
