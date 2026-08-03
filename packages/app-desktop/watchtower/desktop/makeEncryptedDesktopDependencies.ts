import EncryptedJoplinProfileHost from '../profile/EncryptedJoplinProfileHost';
import EncryptedProfileStorage from '../profile/EncryptedProfileStorage';
import {
	EncryptedJoplinProfileHostOptions,
	LoadJoplinProfileRuntime,
} from '../profile/joplinProfileTypes';
import openSqlCipherProfileStorage from '../profile/openSqlCipherProfileStorage';
import {
	SqlCipherProfileConfigurationError,
} from '../profile/sqlCipherProfileTypes';
import {
	VaultAccessAdapter,
	VaultOpenHandle,
	VaultOpenResult,
} from '../vault/PreProfileVaultBootstrap';
import VaultCredentialLifecycle from '../vault/VaultCredentialLifecycle';
import {
	VaultSessionKeyRing,
} from '../vault/vaultKeyEnvelope';
import VaultKeyEnvelopeStore from '../vault/vaultKeyEnvelopeStore';
import {
	WatchtowerDesktopDependencies,
} from './startWatchtowerDesktop';

export interface EncryptedDesktopUnlockCommand {
	kind: 'unlock';
	passphrase: string;
}

export interface EncryptedDesktopCreateCommand {
	kind: 'create';
	passphrase: string;
	confirmRecoverySecret(recoverySecret: string): Promise<string|undefined>;
}

export interface EncryptedDesktopRecoverCommand {
	kind: 'recover';
	recoverySecret: string;
	newPassphrase: string;
}

export interface EncryptedDesktopChangePassphraseCommand {
	kind: 'changePassphrase';
	currentPassphrase: string;
	newPassphrase: string;
}

export interface EncryptedDesktopReplaceRecoverySecretCommand {
	kind: 'replaceRecoverySecret';
	passphrase: string;
	confirmRecoverySecret(recoverySecret: string): Promise<string|undefined>;
}

export type EncryptedDesktopCommand =
	EncryptedDesktopUnlockCommand|EncryptedDesktopCreateCommand|
	EncryptedDesktopRecoverCommand|EncryptedDesktopChangePassphraseCommand|
	EncryptedDesktopReplaceRecoverySecretCommand;

export interface EncryptedDesktopDependencyOptions {
	command: EncryptedDesktopCommand;
	databasePath: string;
	envelopeDirectory: string;
	loadJoplinProfileRuntime: LoadJoplinProfileRuntime;
	openProfileStorage?: (
		keyRing: VaultSessionKeyRing,
	)=> Promise<EncryptedProfileStorage>;
	profileHostOptions: EncryptedJoplinProfileHostOptions;
}

class EncryptedProfileVaultHandle implements VaultOpenHandle {

	public constructor(
		private readonly storage_: EncryptedProfileStorage,
		private readonly keyRing_: VaultSessionKeyRing,
		private readonly release_: ()=> void,
	) {}

	public async close(signal: AbortSignal): Promise<void> {
		try {
			await this.storage_.close(signal);
		} finally {
			this.keyRing_.dispose();
			this.release_();
		}
	}

	public terminate(): boolean {
		try {
			return this.storage_.terminate();
		} finally {
			this.keyRing_.dispose();
			this.release_();
		}
	}
}

const failedClosed = (): VaultOpenResult => ({
	kind: 'failedClosed',
	reason: 'corruptVault',
});

export const makeEncryptedDesktopDependencies = (
	options: EncryptedDesktopDependencyOptions,
): WatchtowerDesktopDependencies => {
	let pendingPassphrase = options.command.kind === 'recover' ? '' :
		options.command.kind === 'changePassphrase' ?
			options.command.currentPassphrase : options.command.passphrase;
	let pendingNewPassphrase = options.command.kind === 'recover' ||
		options.command.kind === 'changePassphrase' ? options.command.newPassphrase : '';
	let pendingRecoverySecret = options.command.kind === 'recover' ?
		options.command.recoverySecret : '';
	if (options.command.kind === 'recover') {
		options.command.newPassphrase = '';
		options.command.recoverySecret = '';
	} else if (options.command.kind === 'changePassphrase') {
		options.command.currentPassphrase = '';
		options.command.newPassphrase = '';
	} else {
		options.command.passphrase = '';
	}
	const {
		databasePath,
		envelopeDirectory,
		loadJoplinProfileRuntime,
		profileHostOptions,
	} = options;
	const credentialLifecycle = new VaultCredentialLifecycle(
		new VaultKeyEnvelopeStore(envelopeDirectory),
	);
	const openProfileStorage = options.openProfileStorage ??
		(keyRing => openSqlCipherProfileStorage(databasePath, keyRing));
	let activeStorage: EncryptedProfileStorage|undefined;
	const openWithKeyRing = async (
		keyRing: VaultSessionKeyRing,
		signal: AbortSignal,
	): Promise<VaultOpenResult> => {
		if (signal.aborted) {
			keyRing.dispose();
			return failedClosed();
		}
		try {
			const storage = await openProfileStorage(keyRing);
			if (signal.aborted) {
				storage.terminate();
				keyRing.dispose();
				return failedClosed();
			}
			activeStorage = storage;
			return {
				kind: 'opened',
				handle: new EncryptedProfileVaultHandle(
					storage,
					keyRing,
					() => {
						if (activeStorage === storage) activeStorage = undefined;
					},
				),
			};
		} catch (error) {
			keyRing.dispose();
			if (
				error instanceof SqlCipherProfileConfigurationError &&
				error.code === 'incompatibleSqlCipherBuild'
			) {
				return { kind: 'failedClosed', reason: 'unsupportedVersion' };
			}
			return failedClosed();
		}
	};

	const create = async (signal: AbortSignal): Promise<VaultOpenResult> => {
		if (options.command.kind !== 'create' || signal.aborted) return failedClosed();
		let passphrase = pendingPassphrase;
		pendingPassphrase = '';
		if (!passphrase) return { kind: 'rejected', reason: 'passphraseRejected' };
		const begun = await credentialLifecycle.beginCreate({
			passphrase,
			memoryProfile: 'standard',
		});
		passphrase = '';
		if (begun.kind === 'rejected') return begun;
		if (begun.kind === 'failedClosed' || signal.aborted) return failedClosed();
		let recoverySecret = begun.recoverySecret;
		const confirmation = await options.command.confirmRecoverySecret(recoverySecret);
		recoverySecret = '';
		if (!confirmation || signal.aborted) return failedClosed();
		const confirmed = await credentialLifecycle.confirmCreate({
			creationId: begun.creationId,
			recoverySecret: confirmation,
		});
		if (confirmed.kind === 'rejected') {
			if (confirmed.reason === 'wrongCredential') {
				return { kind: 'rejected', reason: 'wrongCredential' };
			}
			return failedClosed();
		}
		if (confirmed.kind === 'failedClosed') return failedClosed();
		return openWithKeyRing(confirmed.keyRing, signal);
	};

	const unlock = async (signal: AbortSignal): Promise<VaultOpenResult> => {
		if (signal.aborted) return failedClosed();
		if (options.command.kind === 'replaceRecoverySecret') {
			let passphrase = pendingPassphrase;
			pendingPassphrase = '';
			if (!passphrase) return { kind: 'rejected', reason: 'wrongCredential' };
			const begun = await credentialLifecycle.beginRecoverySecretReplacement({
				passphrase,
			});
			passphrase = '';
			if (begun.kind === 'rejected') {
				return { kind: 'rejected', reason: begun.reason };
			}
			if (begun.kind === 'failedClosed' || signal.aborted) return failedClosed();
			let recoverySecret = begun.recoverySecret;
			const confirmation = await options.command.confirmRecoverySecret(recoverySecret);
			recoverySecret = '';
			if (!confirmation || signal.aborted) return failedClosed();
			const confirmed = await credentialLifecycle.confirmRecoverySecretReplacement({
				rotationId: begun.rotationId,
				recoverySecret: confirmation,
			});
			if (confirmed.kind === 'rejected') {
				if (confirmed.reason === 'wrongCredential') {
					return { kind: 'rejected', reason: 'wrongCredential' };
				}
				return failedClosed();
			}
			if (confirmed.kind === 'failedClosed') return failedClosed();
			return openWithKeyRing(confirmed.keyRing, signal);
		}
		if (options.command.kind === 'changePassphrase') {
			let currentPassphrase = pendingPassphrase;
			let newPassphrase = pendingNewPassphrase;
			pendingPassphrase = '';
			pendingNewPassphrase = '';
			if (!currentPassphrase || !newPassphrase) {
				currentPassphrase = '';
				newPassphrase = '';
				return { kind: 'rejected', reason: 'wrongCredential' };
			}
			const changed = await credentialLifecycle.changePassphrase({
				currentPassphrase,
				newPassphrase,
				memoryProfile: 'standard',
			});
			currentPassphrase = '';
			newPassphrase = '';
			if (changed.kind === 'rejected') {
				if (changed.reason === 'passphraseRejected') {
					return { kind: 'rejected', reason: 'passphraseRejected' };
				}
				if (changed.reason === 'missingVault' || changed.reason === 'wrongCredential') {
					return { kind: 'rejected', reason: changed.reason };
				}
				return failedClosed();
			}
			if (changed.kind === 'failedClosed') return failedClosed();
			return openWithKeyRing(changed.keyRing, signal);
		}
		const passphrase = pendingPassphrase;
		pendingPassphrase = '';
		if (!passphrase) {
			return { kind: 'rejected', reason: 'wrongCredential' };
		}
		const result = await credentialLifecycle.unlockWithPassphrase(
			passphrase,
		);
		if (result.kind === 'rejected') {
			if (
				result.reason === 'missingVault' ||
				result.reason === 'wrongCredential'
			) {
				return { kind: 'rejected', reason: result.reason };
			}
			return failedClosed();
		}
		if (result.kind === 'failedClosed') return failedClosed();
		return openWithKeyRing(result.keyRing, signal);
	};

	const recover = async (signal: AbortSignal): Promise<VaultOpenResult> => {
		if (options.command.kind !== 'recover' || signal.aborted) return failedClosed();
		let recoverySecret = pendingRecoverySecret;
		let newPassphrase = pendingNewPassphrase;
		pendingRecoverySecret = '';
		pendingNewPassphrase = '';
		if (!recoverySecret || !newPassphrase) {
			recoverySecret = '';
			newPassphrase = '';
			return { kind: 'rejected', reason: 'wrongCredential' };
		}
		const result = await credentialLifecycle.recoverWithRecoverySecret({
			recoverySecret,
			newPassphrase,
			memoryProfile: 'standard',
		});
		recoverySecret = '';
		newPassphrase = '';
		if (result.kind === 'rejected') {
			if (result.reason === 'passphraseRejected') {
				return { kind: 'rejected', reason: 'passphraseRejected' };
			}
			if (result.reason === 'missingVault' || result.reason === 'wrongCredential') {
				return { kind: 'rejected', reason: result.reason };
			}
			return failedClosed();
		}
		if (result.kind === 'failedClosed') return failedClosed();
		return openWithKeyRing(result.keyRing, signal);
	};

	const accessAdapter: VaultAccessAdapter = {
		create,
		unlock,
		recover,
		abort: () => false,
	};
	const profileHost = new EncryptedJoplinProfileHost(
		() => {
			if (!activeStorage) {
				throw new Error('Encrypted profile storage is unavailable');
			}
			return activeStorage;
		},
		loadJoplinProfileRuntime,
		profileHostOptions,
	);

	return {
		operation: options.command.kind === 'changePassphrase' ||
			options.command.kind === 'replaceRecoverySecret' ?
			'unlock' : options.command.kind,
		accessAdapter,
		profileHost,
		options: {
			operationTimeoutMs: 60_000,
			profileStartTimeoutMs: 120_000,
		},
	};
};
