import { join } from 'path';
import VaultCredentialLifecycle from '../vault/VaultCredentialLifecycle';
import VaultKeyEnvelopeStore from '../vault/vaultKeyEnvelopeStore';
import VaultRetirementRegistry from '../vault/VaultRetirementRegistry';
import type { VaultStartResult } from '../vault/PreProfileVaultBootstrap';

export const vaultRetirementConfirmation = 'DELETE MY VAULT';

export interface RetireEncryptedDesktopVaultOptions {
	command: {
		kind: 'retireVault';
		passphrase: string;
		confirmation: string;
	};
	userDataDirectory: string;
	signal: AbortSignal;
}

export type RetireEncryptedDesktopVaultStart = {
	result: { kind: 'retired' }|Exclude<VaultStartResult, { kind: 'unlocked' }>;
};

const retireEncryptedDesktopVault = async (
	options: RetireEncryptedDesktopVaultOptions,
): Promise<RetireEncryptedDesktopVaultStart> => {
	let passphrase = options.command.passphrase;
	let confirmation = options.command.confirmation;
	options.command.passphrase = '';
	options.command.confirmation = '';
	try {
		if (options.signal.aborted) {
			return { result: { kind: 'rejected', reason: 'cancelled' } };
		}
		if (confirmation !== vaultRetirementConfirmation) {
			return { result: { kind: 'rejected', reason: 'wrongCredential' } };
		}
		confirmation = '';

		const vaultDirectory = join(options.userDataDirectory, 'vault');
		const lifecycle = new VaultCredentialLifecycle(
			new VaultKeyEnvelopeStore(join(vaultDirectory, 'envelope')),
			new VaultRetirementRegistry(options.userDataDirectory),
		);
		const result = await lifecycle.retireWithPassphrase({ passphrase });
		if (result.kind === 'retired') return { result };
		if (result.kind === 'rejected') return { result };
		return {
			result: {
				kind: 'failedClosed',
				stage: 'vaultAccess',
				reason: 'corruptVault',
			},
		};
	} finally {
		passphrase = '';
		confirmation = '';
	}
};

export default retireEncryptedDesktopVault;
