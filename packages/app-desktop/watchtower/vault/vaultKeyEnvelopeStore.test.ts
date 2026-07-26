import { createHash } from 'crypto';
import { mkdtemp, rename, rm, writeFile } from 'fs/promises';
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

	beforeEach(async () => {
		storeDirectory = await mkdtemp(join(tmpdir(), 'watchtower-envelope-store-'));
	});

	afterEach(async () => {
		jest.mocked(rename).mockClear();
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
		replacement.passphrase.wrappedKey.ciphertext = `${
			replacement.passphrase.wrappedKey.ciphertext.slice(0, -1)
		}${replacement.passphrase.wrappedKey.ciphertext.endsWith('A') ? 'B' : 'A'}`;
		const store = new VaultKeyEnvelopeStore(storeDirectory);
		await store.commit(first.publicState);
		jest.mocked(rename).mockRejectedValueOnce(
			new Error('simulated forced termination'),
		);

		await expect(store.commit(replacement)).rejects.toThrow(
			'Vault Key Envelope commit failed closed',
		);

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
