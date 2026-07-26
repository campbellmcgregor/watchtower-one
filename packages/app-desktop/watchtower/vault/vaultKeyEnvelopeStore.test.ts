import { createHash } from 'crypto';
import * as fileSystem from 'fs/promises';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import VaultKeyEnvelope from './vaultKeyEnvelope';
import VaultKeyEnvelopeStore from './vaultKeyEnvelopeStore';

// cspell:ignore sqlcipher

describe('VaultKeyEnvelopeStore', () => {
	let storeDirectory = '';

	beforeEach(async () => {
		storeDirectory = await mkdtemp(join(tmpdir(), 'watchtower-envelope-store-'));
	});

	afterEach(async () => {
		jest.restoreAllMocks();
		await rm(storeDirectory, { recursive: true, force: true });
	});

	test('reopens the committed envelope after a process restart', async () => {
		const passphrase = 'correct horse battery staple';
		const created = await VaultKeyEnvelope.create({
			passphrase,
			passphraseKdf: {
				memoryKiB: 128 * 1024,
				parallelism: 4,
				passes: 1,
			},
		});
		const initialStore = new VaultKeyEnvelopeStore(storeDirectory);

		await initialStore.commit(created.publicState);

		const restartedStore = new VaultKeyEnvelopeStore(storeDirectory);
		const reopenedState = await restartedStore.loadCommitted();
		const keyRing = await VaultKeyEnvelope.unlockWithPassphrase(
			reopenedState,
			passphrase,
		);
		try {
			const fingerprint = await keyRing.withDerivedKey('sqlcipher', key => {
				return createHash('sha256').update(key).digest('hex');
			});
			expect(fingerprint).toHaveLength(64);
		} finally {
			keyRing.dispose();
		}
	});

	test('retains the committed envelope when replacement is interrupted', async () => {
		const first = await VaultKeyEnvelope.create({
			passphrase: 'first committed passphrase',
			passphraseKdf: {
				memoryKiB: 128 * 1024,
				parallelism: 4,
				passes: 1,
			},
		});
		const store = new VaultKeyEnvelopeStore(storeDirectory);
		await store.commit(first.publicState);
		jest.spyOn(fileSystem, 'rename').mockRejectedValueOnce(
			new Error('simulated forced termination'),
		);

		await expect(store.commit(first.publicState)).rejects.toThrow(
			'Vault Key Envelope commit failed closed',
		);

		const reopenedState = await new VaultKeyEnvelopeStore(
			storeDirectory,
		).loadCommitted();
		expect(reopenedState.vaultId).toBe(first.publicState.vaultId);
	});

	test('refuses to replace a committed vault with another vault identity', async () => {
		const first = await VaultKeyEnvelope.create({
			passphrase: 'first committed passphrase',
			passphraseKdf: {
				memoryKiB: 128 * 1024,
				parallelism: 4,
				passes: 1,
			},
		});
		const unrelated = await VaultKeyEnvelope.create({
			passphrase: 'unrelated vault passphrase',
			passphraseKdf: {
				memoryKiB: 128 * 1024,
				parallelism: 4,
				passes: 1,
			},
		});
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
});
