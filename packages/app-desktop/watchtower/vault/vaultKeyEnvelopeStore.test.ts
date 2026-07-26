import { createHash } from 'crypto';
import { mkdtemp, rename, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import VaultKeyEnvelope, {
	maximumVaultKeyEnvelopePublicStateBytes,
} from './vaultKeyEnvelope';
import VaultKeyEnvelopeStore, {
	InvalidCommittedVaultKeyEnvelopeError,
} from './vaultKeyEnvelopeStore';

// cspell:ignore sqlcipher

jest.mock('fs/promises', () => {
	const actual = jest.requireActual('fs/promises');
	return {
		...actual,
		rename: jest.fn(actual.rename),
	};
});

const passphraseKdf = {
	memoryKiB: 128 * 1024,
	parallelism: 4,
	passes: 1,
} as const;

const createEnvelope = async (passphrase: string) => {
	return await VaultKeyEnvelope.create({ passphrase, passphraseKdf });
};

const sqlCipherFingerprint = async (
	publicState: Awaited<ReturnType<typeof createEnvelope>>['publicState'],
	passphrase: string,
) => {
	const keyRing = await VaultKeyEnvelope.unlockWithPassphrase(
		publicState,
		passphrase,
	);
	try {
		return await keyRing.withDerivedKey('sqlcipher', key => {
			return createHash('sha256').update(key).digest('hex');
		});
	} finally {
		keyRing.dispose();
	}
};

describe('VaultKeyEnvelopeStore', () => {
	let storeDirectory = '';
	let storeDirectoryAlias = '';

	beforeEach(async () => {
		storeDirectory = await mkdtemp(join(tmpdir(), 'watchtower-envelope-store-'));
	});

	afterEach(async () => {
		jest.mocked(rename).mockClear();
		if (storeDirectoryAlias) {
			await rm(storeDirectoryAlias, { recursive: true, force: true });
			storeDirectoryAlias = '';
		}
		await rm(storeDirectory, { recursive: true, force: true });
	});

	test('reopens the committed envelope after a process restart', async () => {
		const passphrase = 'correct horse battery staple';
		const created = await createEnvelope(passphrase);
		const initialStore = new VaultKeyEnvelopeStore(storeDirectory);

		await initialStore.commit(created.publicState);

		const restartedStore = new VaultKeyEnvelopeStore(storeDirectory);
		const reopenedState = await restartedStore.loadCommitted();
		expect(await sqlCipherFingerprint(reopenedState, passphrase)).toHaveLength(64);
	});

	test('retains the committed envelope when replacement is interrupted', async () => {
		const passphrase = 'first committed passphrase';
		const first = await createEnvelope(passphrase);
		const replacement = JSON.parse(JSON.stringify(first.publicState));
		const ciphertext = replacement.passphrase.wrappedKey.ciphertext;
		const mutationOffset = Math.floor(ciphertext.length / 2);
		replacement.passphrase.wrappedKey.ciphertext = `${
			ciphertext.slice(0, mutationOffset)
		}${ciphertext[mutationOffset] === 'A' ? 'B' : 'A'}${
			ciphertext.slice(mutationOffset + 1)
		}`;
		const store = new VaultKeyEnvelopeStore(storeDirectory);
		await store.commit(first.publicState);
		jest.mocked(rename).mockClear();
		jest.mocked(rename).mockRejectedValueOnce(
			new Error('simulated forced termination'),
		);

		await expect(store.commit(replacement)).rejects.toThrow(
			'Vault Key Envelope commit failed closed',
		);
		expect(rename).toHaveBeenCalledTimes(1);

		const reopenedState = await new VaultKeyEnvelopeStore(
			storeDirectory,
		).loadCommitted();
		expect(reopenedState).toEqual(first.publicState);
		expect(await sqlCipherFingerprint(reopenedState, passphrase)).toHaveLength(64);
	});

	test('refuses to replace a committed vault with another vault identity', async () => {
		const first = await createEnvelope('first committed passphrase');
		const unrelated = await createEnvelope('unrelated vault passphrase');
		const store = new VaultKeyEnvelopeStore(storeDirectory);
		await store.commit(first.publicState);

		await expect(store.commit(unrelated.publicState)).rejects.toThrow(
			'Vault Key Envelope commit failed closed',
		);

		const reopenedState = await new VaultKeyEnvelopeStore(
			storeDirectory,
		).loadCommitted();
		expect(reopenedState.vaultId).toBe(first.publicState.vaultId);
	});

	test('serializes first commits from separate store instances', async () => {
		const first = await createEnvelope('first concurrent passphrase');
		const second = await createEnvelope('second concurrent passphrase');
		const outcomes = await Promise.allSettled([
			new VaultKeyEnvelopeStore(storeDirectory).commit(first.publicState),
			new VaultKeyEnvelopeStore(storeDirectory).commit(second.publicState),
		]);

		expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
		expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(1);
		const reopenedState = await new VaultKeyEnvelopeStore(
			storeDirectory,
		).loadCommitted();
		expect([
			first.publicState.vaultId,
			second.publicState.vaultId,
		]).toContain(reopenedState.vaultId);
	});

	test('serializes commits through filesystem aliases of the same directory', async () => {
		storeDirectoryAlias = `${storeDirectory}-alias`;
		await symlink(
			storeDirectory,
			storeDirectoryAlias,
			process.platform === 'win32' ? 'junction' : 'dir',
		);
		const first = await createEnvelope('first alias passphrase');
		const second = await createEnvelope('second alias passphrase');
		const outcomes = await Promise.allSettled([
			new VaultKeyEnvelopeStore(storeDirectory).commit(first.publicState),
			new VaultKeyEnvelopeStore(storeDirectoryAlias).commit(second.publicState),
		]);

		expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
		expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(1);
	});

	test('rejects an oversized committed envelope through the bounded reader', async () => {
		await writeFile(
			join(storeDirectory, 'vault-key-envelope.json'),
			Buffer.alloc(maximumVaultKeyEnvelopePublicStateBytes + 1, 65),
		);

		await expect(
			new VaultKeyEnvelopeStore(storeDirectory).loadCommitted(),
		).rejects.toBeInstanceOf(InvalidCommittedVaultKeyEnvelopeError);
	});
});
