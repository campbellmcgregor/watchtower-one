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
	{ kind: 'submitted'; passphrase: string }|
	{ kind: 'cancelled' };

export interface PreProfileUnlockView {
	requestPassphrase(
		feedback?: PreProfileUnlockFeedback,
	): Promise<PreProfileUnlockSubmission>;
	close(): void;
}

export type StartEncryptedDesktopUnlock = (
	command: EncryptedDesktopUnlockCommand,
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

	try {
		while (true) {
			const submission = await view.requestPassphrase(feedback);
			if (submission.kind === 'cancelled') return submission;

			const command: EncryptedDesktopUnlockCommand = {
				kind: 'unlock',
				passphrase: submission.passphrase,
			};
			let started: WatchtowerDesktopStart;
			try {
				started = await startAttempt(command);
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

			if (started.result.kind === 'unlocked') {
				return {
					kind: 'unlocked',
					lifecycle: started.lifecycle,
				};
			}
			return started.result;
		}
	} finally {
		view.close();
	}
};

export default runPreProfileUnlockFlow;
