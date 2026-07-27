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

export interface EncryptedDesktopDependencyOptions {
	command: EncryptedDesktopUnlockCommand;
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

		try {
			const storage = await openProfileStorage(result.keyRing);
			if (signal.aborted) {
				storage.terminate();
				result.keyRing.dispose();
				return failedClosed();
			}
			activeStorage = storage;
			return {
				kind: 'opened',
				handle: new EncryptedProfileVaultHandle(
					storage,
					result.keyRing,
					() => {
						if (activeStorage === storage) activeStorage = undefined;
					},
				),
			};
		} catch (error) {
			result.keyRing.dispose();
			if (
				error instanceof SqlCipherProfileConfigurationError &&
				error.code === 'incompatibleSqlCipherBuild'
			) {
				return { kind: 'failedClosed', reason: 'unsupportedVersion' };
			}
			return failedClosed();
		}
	};

	const unavailable = async (): Promise<VaultOpenResult> => failedClosed();
	const accessAdapter: VaultAccessAdapter = {
		create: unavailable,
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
		operation: 'unlock',
		accessAdapter,
		profileHost,
	};
};
