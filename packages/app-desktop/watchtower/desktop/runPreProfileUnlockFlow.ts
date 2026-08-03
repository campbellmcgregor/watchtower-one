import type PreProfileVaultBootstrap from '../vault/PreProfileVaultBootstrap';
import type {
	VaultStartResult,
} from '../vault/PreProfileVaultBootstrap';
import type {
	EncryptedDesktopCommand,
} from './makeEncryptedDesktopDependencies';
import type {
	WatchtowerDesktopStart,
} from './startWatchtowerDesktop';

export type PreProfileUnlockFeedback = {
	kind: 'wrongCredential'|'passphraseRejected'|'alreadyExists';
	operation?: 'recover'|'changePassphrase'|'replaceRecoverySecret'|'retireVault';
};

export type PreProfileUnlockSubmission =
	{ kind: 'submitted'; operation?: 'unlock'|'create'; passphrase: string; signal: AbortSignal }|
	{ kind: 'submitted'; operation: 'recover'; recoverySecret: string; newPassphrase: string; signal: AbortSignal }|
	{ kind: 'submitted'; operation: 'changePassphrase'; currentPassphrase: string; newPassphrase: string; signal: AbortSignal }|
	{ kind: 'submitted'; operation: 'replaceRecoverySecret'; passphrase: string; signal: AbortSignal }|
	{ kind: 'submitted'; operation: 'retireVault'; passphrase: string; confirmation: string; signal: AbortSignal }|
	{ kind: 'cancelled' };

export type PreProfileDesktopCommand = EncryptedDesktopCommand|{
	kind: 'retireVault';
	passphrase: string;
	confirmation: string;
};

export interface PreProfileUnlockView {
	requestPassphrase(
		feedback?: PreProfileUnlockFeedback,
	): Promise<PreProfileUnlockSubmission>;
	confirmRecoverySecret?(
		recoverySecret: string,
		purpose?: 'create'|'replace',
	): Promise<string|undefined>;
	close(): Promise<void>|void;
}

export type StartEncryptedDesktopUnlock = (
	command: PreProfileDesktopCommand,
	signal: AbortSignal,
)=> Promise<WatchtowerDesktopStart|{
	result: { kind: 'retired' }|Exclude<VaultStartResult, { kind: 'unlocked' }>;
}>;

export type PreProfileUnlockFlowResult =
	{ kind: 'cancelled' }|
	{ kind: 'retired' }|
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

			const command: PreProfileDesktopCommand = submission.operation === 'create' ? {
				kind: 'create' as const,
				passphrase: submission.passphrase,
				confirmRecoverySecret: async (recoverySecret: string) => {
					return view.confirmRecoverySecret?.(recoverySecret, 'create');
				},
			} : submission.operation === 'recover' ? {
				kind: 'recover',
				recoverySecret: submission.recoverySecret,
				newPassphrase: submission.newPassphrase,
			} : submission.operation === 'changePassphrase' ? {
				kind: 'changePassphrase',
				currentPassphrase: submission.currentPassphrase,
				newPassphrase: submission.newPassphrase,
			} : submission.operation === 'replaceRecoverySecret' ? {
				kind: 'replaceRecoverySecret',
				passphrase: submission.passphrase,
				confirmRecoverySecret: async (recoverySecret: string) => {
					return view.confirmRecoverySecret?.(recoverySecret, 'replace');
				},
			} : submission.operation === 'retireVault' ? {
				kind: 'retireVault',
				passphrase: submission.passphrase,
				confirmation: submission.confirmation,
			} : {
				kind: 'unlock' as const,
				passphrase: submission.passphrase,
			};
			let started: Awaited<ReturnType<StartEncryptedDesktopUnlock>>;
			try {
				started = await startAttempt(command, submission.signal);
			} finally {
				if (command.kind === 'recover' && submission.operation === 'recover') {
					command.recoverySecret = '';
					command.newPassphrase = '';
					submission.recoverySecret = '';
					submission.newPassphrase = '';
				} else if (
					command.kind === 'changePassphrase' &&
					submission.operation === 'changePassphrase'
				) {
					command.currentPassphrase = '';
					command.newPassphrase = '';
					submission.currentPassphrase = '';
					submission.newPassphrase = '';
				} else if (
					command.kind === 'retireVault' &&
					submission.operation === 'retireVault'
				) {
					command.passphrase = '';
					command.confirmation = '';
					submission.passphrase = '';
					submission.confirmation = '';
				} else if (
					command.kind !== 'recover' && command.kind !== 'changePassphrase' &&
					submission.operation !== 'recover' && submission.operation !== 'changePassphrase'
				) {
					command.passphrase = '';
					submission.passphrase = '';
				}
			}

			if (
				started.result.kind === 'rejected' &&
				[
					'wrongCredential',
					'passphraseRejected',
					'alreadyExists',
				].includes(started.result.reason)
			) {
				feedback = {
					kind: started.result.reason as PreProfileUnlockFeedback['kind'],
					...(command.kind === 'recover' || command.kind === 'changePassphrase' ||
					command.kind === 'replaceRecoverySecret' || command.kind === 'retireVault' ?
						{ operation: command.kind } : {}),
				};
				continue;
			}
			if (
				started.result.kind === 'rejected' &&
				started.result.reason === 'cancelled'
			) {
				return { kind: 'cancelled' };
			}

			if (started.result.kind === 'retired') return started.result;
			if (started.result.kind === 'unlocked') {
				if (!('lifecycle' in started)) {
					throw new Error('Unlocked desktop attempt did not return its lifecycle');
				}
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
