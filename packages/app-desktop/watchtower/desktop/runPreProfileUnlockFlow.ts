import type PreProfileVaultBootstrap from '../vault/PreProfileVaultBootstrap';
import type {
	VaultStartResult,
} from '../vault/PreProfileVaultBootstrap';
import type {
	EncryptedDesktopUnlockCommand,
} from './makeEncryptedDesktopDependencies';
import type {
	WatchtowerDesktopStart,
} from './startWatchtowerDesktop';

export type PreProfileUnlockFeedback = {
	kind: 'wrongCredential';
};

export type PreProfileUnlockSubmission =
	{ kind: 'submitted'; passphrase: string; signal: AbortSignal }|
	{ kind: 'cancelled' };

export interface PreProfileUnlockView {
	requestPassphrase(
		feedback?: PreProfileUnlockFeedback,
	): Promise<PreProfileUnlockSubmission>;
	close(): Promise<void>|void;
}

export type StartEncryptedDesktopUnlock = (
	command: EncryptedDesktopUnlockCommand,
	signal: AbortSignal,
)=> Promise<WatchtowerDesktopStart>;

export type PreProfileUnlockFlowResult =
	{ kind: 'cancelled' }|
	{ kind: 'unlocked'; lifecycle: PreProfileVaultBootstrap }|
	Exclude<VaultStartResult, { kind: 'unlocked' }>;

const runPreProfileUnlockFlow = async (
	view: PreProfileUnlockView,
	startAttempt: StartEncryptedDesktopUnlock,
): Promise<PreProfileUnlockFlowResult> => {
	let feedback: PreProfileUnlockFeedback|undefined;
	let unlockedLifecycle: PreProfileVaultBootstrap|undefined;

	const run = async (): Promise<PreProfileUnlockFlowResult> => {
		while (true) {
			const submission = await view.requestPassphrase(feedback);
			if (submission.kind === 'cancelled') return submission;

			const command: EncryptedDesktopUnlockCommand = {
				kind: 'unlock',
				passphrase: submission.passphrase,
			};
			let started: WatchtowerDesktopStart;
			try {
				started = await startAttempt(command, submission.signal);
			} finally {
				command.passphrase = '';
				submission.passphrase = '';
			}

			if (
				started.result.kind === 'rejected' &&
				started.result.reason === 'wrongCredential'
			) {
				feedback = { kind: 'wrongCredential' };
				continue;
			}
			if (
				started.result.kind === 'rejected' &&
				started.result.reason === 'cancelled'
			) {
				return { kind: 'cancelled' };
			}

			if (started.result.kind === 'unlocked') {
				unlockedLifecycle = started.lifecycle;
				return {
					kind: 'unlocked',
					lifecycle: started.lifecycle,
				};
			}
			return started.result;
		}
	};

	let result: PreProfileUnlockFlowResult|undefined;
	let runError: unknown;
	try {
		result = await run();
	} catch (error) {
		runError = error;
	}
	try {
		await view.close();
	} catch (error) {
		if (unlockedLifecycle) await unlockedLifecycle.end('close');
		throw error;
	}
	if (result === undefined) throw runError;
	return result;
};

export default runPreProfileUnlockFlow;
