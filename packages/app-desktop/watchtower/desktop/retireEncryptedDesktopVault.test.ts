import { access, mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import VaultCredentialLifecycle from '../vault/VaultCredentialLifecycle';
import VaultKeyEnvelopeStore from '../vault/vaultKeyEnvelopeStore';
import VaultRetirementRegistry from '../vault/VaultRetirementRegistry';
import retireEncryptedDesktopVault, {
	vaultRetirementConfirmation,
} from './retireEncryptedDesktopVault';

describe('retireEncryptedDesktopVault', () => {
	let userDataDirectory = '';

	beforeEach(async () => {
		userDataDirectory = await mkdtemp(join(tmpdir(), 'watchtower-desktop-retirement-'));
	});

	afterEach(async () => {
		await rm(userDataDirectory, { recursive: true, force: true });
	});

	test('requires passphrase and exact destructive confirmation before deleting the encrypted vault', async () => {
		const vaultDirectory = join(userDataDirectory, 'vault');
		const envelopeDirectory = join(vaultDirectory, 'envelope');
		await mkdir(envelopeDirectory, { recursive: true });
		const lifecycle = new VaultCredentialLifecycle(
			new VaultKeyEnvelopeStore(envelopeDirectory),
			new VaultRetirementRegistry(userDataDirectory),
		);
		const begun = await lifecycle.beginCreate({
			passphrase: 'current private atlas words',
			memoryProfile: 'qualified-constrained',
		});
		if (begun.kind !== 'recoveryConfirmationRequired') {
			throw new Error('Expected vault creation to begin');
		}
		const created = await lifecycle.confirmCreate({
			creationId: begun.creationId,
			recoverySecret: begun.recoverySecret,
		});
		if (created.kind !== 'opened') throw new Error('Expected vault creation');
		created.keyRing.dispose();
		await writeFile(join(vaultDirectory, 'profile.sqlite'), 'encrypted bytes');

		const rejectedCommand = {
			kind: 'retireVault' as const,
			passphrase: 'current private atlas words',
			confirmation: 'delete my vault',
		};
		await expect(retireEncryptedDesktopVault({
			command: rejectedCommand,
			userDataDirectory,
			signal: new AbortController().signal,
		})).resolves.toEqual({ result: { kind: 'rejected', reason: 'wrongCredential' } });
		expect(rejectedCommand).toMatchObject({ passphrase: '', confirmation: '' });
		await expect(access(vaultDirectory)).resolves.toBeUndefined();

		const acceptedCommand = {
			kind: 'retireVault' as const,
			passphrase: 'current private atlas words',
			confirmation: vaultRetirementConfirmation,
		};
		await expect(retireEncryptedDesktopVault({
			command: acceptedCommand,
			userDataDirectory,
			signal: new AbortController().signal,
		})).resolves.toEqual({ result: { kind: 'retired' } });
		expect(acceptedCommand).toMatchObject({ passphrase: '', confirmation: '' });
		await expect(access(vaultDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
	});
});
