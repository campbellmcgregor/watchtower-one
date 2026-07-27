import { randomBytes } from 'crypto';
import VaultKeyEnvelope, {
	InvalidVaultKeyEnvelopeError,
	VaultKeyEnvelopePublicState,
	VaultSessionKeyRing,
} from './vaultKeyEnvelope';
import VaultKeyEnvelopeStore, {
	InvalidCommittedVaultKeyEnvelopeError,
} from './vaultKeyEnvelopeStore';
import VaultPassphrasePolicy, {
	VaultPassphraseMemoryProfile,
	VaultPassphrasePolicyError,
} from './vaultPassphrasePolicy';

export interface BeginVaultCreationOptions {
	passphrase: string;
	memoryProfile: VaultPassphraseMemoryProfile;
}

export interface ConfirmVaultCreationOptions {
	creationId: string;
	recoverySecret: string;
}

export interface RecoverVaultOptions {
	recoverySecret: string;
	newPassphrase: string;
	memoryProfile: VaultPassphraseMemoryProfile;
}

export interface ChangeVaultPassphraseOptions {
	currentPassphrase: string;
	newPassphrase: string;
	memoryProfile: VaultPassphraseMemoryProfile;
}

export interface ConfirmRecoverySecretReplacementOptions {
	rotationId: string;
	recoverySecret: string;
}

export type BeginVaultCreationResult =
	{
		kind: 'recoveryConfirmationRequired';
		creationId: string;
		recoverySecret: string;
	}|
	{ kind: 'rejected'; reason: 'alreadyExists'|'passphraseRejected' }|
	{ kind: 'failedClosed' };

export type BeginRecoverySecretReplacementResult =
	{
		kind: 'recoveryConfirmationRequired';
		rotationId: string;
		recoverySecret: string;
	}|
	{ kind: 'rejected'; reason: 'missingVault'|'wrongCredential' }|
	{ kind: 'failedClosed' };

export type VaultCredentialOpenResult =
	{ kind: 'opened'; keyRing: VaultSessionKeyRing }|
	{
		kind: 'rejected';
		reason: 'missingVault'|'passphraseRejected'|'staleAttempt'|'wrongCredential';
	}|
	{ kind: 'failedClosed' };

interface PendingVaultCreation {
	creationId: string;
	publicState: VaultKeyEnvelopePublicState;
}

interface PendingRecoverySecretReplacement {
	rotationId: string;
	publicState: VaultKeyEnvelopePublicState;
}

export default class VaultCredentialLifecycle {
	private pendingCreation_: PendingVaultCreation|null = null;
	private pendingRecoveryReplacement_: PendingRecoverySecretReplacement|null = null;

	public constructor(private readonly store_: VaultKeyEnvelopeStore) {}

	public async beginCreate(
		options: BeginVaultCreationOptions,
	): Promise<BeginVaultCreationResult> {
		try {
			const inspection = await this.store_.inspectCommitted();
			if (inspection.kind === 'committed') {
				return { kind: 'rejected', reason: 'alreadyExists' };
			}
		} catch {
			return { kind: 'failedClosed' };
		}

		try {
			const passphraseKdf = await VaultPassphrasePolicy.prepareForVaultCreation(
				options.passphrase,
				options.memoryProfile,
			);
			const created = await VaultKeyEnvelope.create({
				passphrase: options.passphrase,
				passphraseKdf,
			});
			const creationId = randomBytes(16).toString('base64url');
			this.pendingCreation_ = {
				creationId,
				publicState: created.publicState,
			};
			return {
				kind: 'recoveryConfirmationRequired',
				creationId,
				recoverySecret: created.recoverySecret,
			};
		} catch (error) {
			if (error instanceof VaultPassphrasePolicyError) {
				return { kind: 'rejected', reason: 'passphraseRejected' };
			}
			return { kind: 'failedClosed' };
		}
	}

	public async confirmCreate(
		options: ConfirmVaultCreationOptions,
	): Promise<VaultCredentialOpenResult> {
		const pending = this.pendingCreation_;
		if (!pending || pending.creationId !== options.creationId) {
			return { kind: 'rejected', reason: 'staleAttempt' };
		}

		let verificationKeyRing: VaultSessionKeyRing;
		try {
			verificationKeyRing = await VaultKeyEnvelope.unlockWithRecoverySecret(
				pending.publicState,
				options.recoverySecret,
			);
		} catch (error) {
			if (error instanceof InvalidVaultKeyEnvelopeError) {
				return { kind: 'rejected', reason: 'wrongCredential' };
			}
			return { kind: 'failedClosed' };
		}
		verificationKeyRing.dispose();

		try {
			await this.store_.commit(pending.publicState);
			const committed = await this.store_.loadCommitted();
			const keyRing = await VaultKeyEnvelope.unlockWithRecoverySecret(
				committed,
				options.recoverySecret,
			);
			this.pendingCreation_ = null;
			return { kind: 'opened', keyRing };
		} catch {
			this.pendingCreation_ = null;
			return { kind: 'failedClosed' };
		}
	}

	public async unlockWithPassphrase(
		passphrase: string,
	): Promise<VaultCredentialOpenResult> {
		let committed: VaultKeyEnvelopePublicState;
		try {
			const inspection = await this.store_.inspectCommitted();
			if (inspection.kind === 'missing') {
				return { kind: 'rejected', reason: 'missingVault' };
			}
			committed = inspection.publicState;
		} catch (error) {
			if (error instanceof InvalidCommittedVaultKeyEnvelopeError) {
				return { kind: 'failedClosed' };
			}
			return { kind: 'failedClosed' };
		}

		try {
			return {
				kind: 'opened',
				keyRing: await VaultKeyEnvelope.unlockWithPassphrase(
					committed,
					passphrase,
				),
			};
		} catch (error) {
			if (error instanceof InvalidVaultKeyEnvelopeError) {
				return { kind: 'rejected', reason: 'wrongCredential' };
			}
			return { kind: 'failedClosed' };
		}
	}

	public async recoverWithRecoverySecret(
		options: RecoverVaultOptions,
	): Promise<VaultCredentialOpenResult> {
		let committed: VaultKeyEnvelopePublicState;
		try {
			const inspection = await this.store_.inspectCommitted();
			if (inspection.kind === 'missing') {
				return { kind: 'rejected', reason: 'missingVault' };
			}
			committed = inspection.publicState;
		} catch {
			return { kind: 'failedClosed' };
		}

		let recoveryKeyRing: VaultSessionKeyRing;
		try {
			recoveryKeyRing = await VaultKeyEnvelope.unlockWithRecoverySecret(
				committed,
				options.recoverySecret,
			);
		} catch (error) {
			if (error instanceof InvalidVaultKeyEnvelopeError) {
				return { kind: 'rejected', reason: 'wrongCredential' };
			}
			return { kind: 'failedClosed' };
		}

		try {
			const passphraseKdf = await VaultPassphrasePolicy.prepareForVaultCreation(
				options.newPassphrase,
				options.memoryProfile,
			);
			const replacement = await VaultKeyEnvelope.replacePassphrase(
				committed,
				recoveryKeyRing,
				options.newPassphrase,
				passphraseKdf,
			);

			const verificationKeyRing = await VaultKeyEnvelope.unlockWithPassphrase(
				replacement,
				options.newPassphrase,
			);
			verificationKeyRing.dispose();

			await this.store_.commit(replacement);
			const durableReplacement = await this.store_.loadCommitted();
			return {
				kind: 'opened',
				keyRing: await VaultKeyEnvelope.unlockWithPassphrase(
					durableReplacement,
					options.newPassphrase,
				),
			};
		} catch (error) {
			if (error instanceof VaultPassphrasePolicyError) {
				return { kind: 'rejected', reason: 'passphraseRejected' };
			}
			return { kind: 'failedClosed' };
		} finally {
			recoveryKeyRing.dispose();
		}
	}

	public async changePassphrase(
		options: ChangeVaultPassphraseOptions,
	): Promise<VaultCredentialOpenResult> {
		let committed: VaultKeyEnvelopePublicState;
		try {
			const inspection = await this.store_.inspectCommitted();
			if (inspection.kind === 'missing') {
				return { kind: 'rejected', reason: 'missingVault' };
			}
			committed = inspection.publicState;
		} catch {
			return { kind: 'failedClosed' };
		}

		let currentKeyRing: VaultSessionKeyRing;
		try {
			currentKeyRing = await VaultKeyEnvelope.unlockWithPassphrase(
				committed,
				options.currentPassphrase,
			);
		} catch (error) {
			if (error instanceof InvalidVaultKeyEnvelopeError) {
				return { kind: 'rejected', reason: 'wrongCredential' };
			}
			return { kind: 'failedClosed' };
		}

		try {
			const passphraseKdf = await VaultPassphrasePolicy.prepareForVaultCreation(
				options.newPassphrase,
				options.memoryProfile,
			);
			const replacement = await VaultKeyEnvelope.replacePassphrase(
				committed,
				currentKeyRing,
				options.newPassphrase,
				passphraseKdf,
			);
			const verificationKeyRing = await VaultKeyEnvelope.unlockWithPassphrase(
				replacement,
				options.newPassphrase,
			);
			verificationKeyRing.dispose();
			await this.store_.commit(replacement);
			return {
				kind: 'opened',
				keyRing: await VaultKeyEnvelope.unlockWithPassphrase(
					await this.store_.loadCommitted(),
					options.newPassphrase,
				),
			};
		} catch (error) {
			if (error instanceof VaultPassphrasePolicyError) {
				return { kind: 'rejected', reason: 'passphraseRejected' };
			}
			return { kind: 'failedClosed' };
		} finally {
			currentKeyRing.dispose();
		}
	}

	public async beginRecoverySecretReplacement(
		options: { passphrase: string },
	): Promise<BeginRecoverySecretReplacementResult> {
		let committed: VaultKeyEnvelopePublicState;
		try {
			const inspection = await this.store_.inspectCommitted();
			if (inspection.kind === 'missing') {
				return { kind: 'rejected', reason: 'missingVault' };
			}
			committed = inspection.publicState;
		} catch {
			return { kind: 'failedClosed' };
		}

		let keyRing: VaultSessionKeyRing;
		try {
			keyRing = await VaultKeyEnvelope.unlockWithPassphrase(
				committed,
				options.passphrase,
			);
		} catch (error) {
			if (error instanceof InvalidVaultKeyEnvelopeError) {
				return { kind: 'rejected', reason: 'wrongCredential' };
			}
			return { kind: 'failedClosed' };
		}

		try {
			const replacement = VaultKeyEnvelope.replaceRecoverySecret(
				committed,
				keyRing,
			);
			const rotationId = randomBytes(16).toString('base64url');
			this.pendingRecoveryReplacement_ = {
				rotationId,
				publicState: replacement.publicState,
			};
			return {
				kind: 'recoveryConfirmationRequired',
				rotationId,
				recoverySecret: replacement.recoverySecret,
			};
		} catch {
			return { kind: 'failedClosed' };
		} finally {
			keyRing.dispose();
		}
	}

	public async confirmRecoverySecretReplacement(
		options: ConfirmRecoverySecretReplacementOptions,
	): Promise<VaultCredentialOpenResult> {
		const pending = this.pendingRecoveryReplacement_;
		if (!pending || pending.rotationId !== options.rotationId) {
			return { kind: 'rejected', reason: 'staleAttempt' };
		}

		let verificationKeyRing: VaultSessionKeyRing;
		try {
			verificationKeyRing = await VaultKeyEnvelope.unlockWithRecoverySecret(
				pending.publicState,
				options.recoverySecret,
			);
		} catch (error) {
			if (error instanceof InvalidVaultKeyEnvelopeError) {
				return { kind: 'rejected', reason: 'wrongCredential' };
			}
			return { kind: 'failedClosed' };
		}
		verificationKeyRing.dispose();

		try {
			await this.store_.commit(pending.publicState);
			const committed = await this.store_.loadCommitted();
			const keyRing = await VaultKeyEnvelope.unlockWithRecoverySecret(
				committed,
				options.recoverySecret,
			);
			this.pendingRecoveryReplacement_ = null;
			return { kind: 'opened', keyRing };
		} catch {
			this.pendingRecoveryReplacement_ = null;
			return { kind: 'failedClosed' };
		}
	}
}
