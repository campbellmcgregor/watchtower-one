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

export type EncryptedDesktopCommand =
	EncryptedDesktopUnlockCommand|EncryptedDesktopCreateCommand;

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
	let pendingPassphrase = options.command.passphrase;
	options.command.passphrase = '';
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

	const unavailable = async (): Promise<VaultOpenResult> => failedClosed();
	const accessAdapter: VaultAccessAdapter = {
		create,
		unlock,
		recover: unavailable,
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
		operation: options.command.kind,
		accessAdapter,
		profileHost,
		options: {
			operationTimeoutMs: 60_000,
			profileStartTimeoutMs: 120_000,
		},
	};
};
