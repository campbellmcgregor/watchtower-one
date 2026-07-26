import { createHash } from 'crypto';
import VaultKeyEnvelope, {
	InvalidVaultKeyEnvelopeError,
	VaultKeyPurpose,
} from './VaultKeyEnvelope';

// cspell:ignore HJKMNP sqlcipher

const passphraseKdf = {
	memoryKiB: 128 * 1024,
	parallelism: 4,
	passes: 1,
} as const;

const fingerprint = async (
	keyRing: Awaited<ReturnType<typeof VaultKeyEnvelope.unlockWithPassphrase>>,
	purpose: VaultKeyPurpose,
) => {
	return keyRing.withDerivedKey(purpose, key => {
		return createHash('sha256').update(key).digest('hex');
	});
};

describe('VaultKeyEnvelope', () => {
	test('a passphrase unlocks stable domain-separated vault keys', async () => {
		const passphrase = 'correct horse battery staple';
		const created = await VaultKeyEnvelope.create({
			passphrase,
			passphraseKdf,
		});

		const firstUnlock = await VaultKeyEnvelope.unlockWithPassphrase(
			created.publicState,
			passphrase,
		);
		const secondUnlock = await VaultKeyEnvelope.unlockWithPassphrase(
			created.publicState,
			passphrase,
		);

		try {
			const firstDatabaseKey = await fingerprint(firstUnlock, 'sqlcipher');
			const secondDatabaseKey = await fingerprint(secondUnlock, 'sqlcipher');
			const resourceKey = await fingerprint(firstUnlock, 'resource-content');

			expect(firstDatabaseKey).toBe(secondDatabaseKey);
			expect(resourceKey).not.toBe(firstDatabaseKey);
			expect(JSON.stringify(created.publicState)).not.toContain(passphrase);
		} finally {
			firstUnlock.dispose();
			secondUnlock.dispose();
		}
	});

	test('the generated Recovery Secret independently unlocks the same vault', async () => {
		const passphrase = 'correct horse battery staple';
		const created = await VaultKeyEnvelope.create({
			passphrase,
			passphraseKdf,
		});

		const passphraseUnlock = await VaultKeyEnvelope.unlockWithPassphrase(
			created.publicState,
			passphrase,
		);
		const recoveryUnlock = await VaultKeyEnvelope.unlockWithRecoverySecret(
			created.publicState,
			created.recoverySecret,
		);

		try {
			expect(created.recoverySecret).toMatch(/^WT1(?:-[0-9A-HJKMNP-TV-Z]{4})+$/);
			expect(JSON.stringify(created.publicState)).not.toContain(created.recoverySecret);
			expect(await fingerprint(recoveryUnlock, 'sqlcipher')).toBe(
				await fingerprint(passphraseUnlock, 'sqlcipher'),
			);
		} finally {
			passphraseUnlock.dispose();
			recoveryUnlock.dispose();
		}
	});

	test('a persisted public envelope is parsed before it can be unlocked', async () => {
		const passphrase = 'correct horse battery staple';
		const created = await VaultKeyEnvelope.create({
			passphrase,
			passphraseKdf,
		});
		const parsed = VaultKeyEnvelope.parsePublicState(
			JSON.stringify(created.publicState),
		);

		const keyRing = await VaultKeyEnvelope.unlockWithPassphrase(parsed, passphrase);
		try {
			expect(await fingerprint(keyRing, 'sqlcipher')).toHaveLength(64);
		} finally {
			keyRing.dispose();
		}
	});

	test('pre-unlock inspection exposes only bounded technical metadata', async () => {
		const created = await VaultKeyEnvelope.create({
			passphrase: 'correct horse battery staple',
			passphraseKdf,
		});

		expect(VaultKeyEnvelope.inspectPublicState(
			JSON.stringify(created.publicState),
		)).toEqual({
			format: 'watchtower-vault-key-envelope',
			version: 1,
			vaultId: created.publicState.vaultId,
			activeGeneration: 1,
			passphraseKdf: {
				algorithm: 'argon2id',
				version: 19,
				memoryKiB: 128 * 1024,
				parallelism: 4,
				passes: 1,
			},
			recoveryAvailable: true,
		});
	});

	test('incorrect passphrase and Recovery Secret fail with the same public error', async () => {
		const created = await VaultKeyEnvelope.create({
			passphrase: 'correct horse battery staple',
			passphraseKdf,
		});
		const alteredRecoverySecret = `${
			created.recoverySecret.slice(0, -1)
		}${created.recoverySecret.endsWith('0') ? '1' : '0'}`;

		await expect(VaultKeyEnvelope.unlockWithPassphrase(
			created.publicState,
			'incorrect horse battery staple',
		)).rejects.toEqual(new InvalidVaultKeyEnvelopeError());
		await expect(VaultKeyEnvelope.unlockWithRecoverySecret(
			created.publicState,
			alteredRecoverySecret,
		)).rejects.toEqual(new InvalidVaultKeyEnvelopeError());
	});

	test('untrusted public state cannot request excessive Argon2 resources', async () => {
		const created = await VaultKeyEnvelope.create({
			passphrase: 'correct horse battery staple',
			passphraseKdf,
		});
		const untrustedState = JSON.parse(JSON.stringify(created.publicState));
		untrustedState.passphrase.kdf.memoryKiB = 1024 * 1024 + 1;

		expect(() => VaultKeyEnvelope.parsePublicState(
			JSON.stringify(untrustedState),
		)).toThrow(InvalidVaultKeyEnvelopeError);
	});

	test('authenticated envelope corruption fails closed', async () => {
		const passphrase = 'correct horse battery staple';
		const created = await VaultKeyEnvelope.create({
			passphrase,
			passphraseKdf,
		});
		const corruptedState = JSON.parse(JSON.stringify(created.publicState));
		const ciphertext = Buffer.from(
			corruptedState.passphrase.wrappedKey.ciphertext,
			'base64url',
		);
		ciphertext[0] ^= 1;
		corruptedState.passphrase.wrappedKey.ciphertext = ciphertext.toString('base64url');
		const parsed = VaultKeyEnvelope.parsePublicState(
			JSON.stringify(corruptedState),
		);

		await expect(VaultKeyEnvelope.unlockWithPassphrase(
			parsed,
			passphrase,
		)).rejects.toEqual(new InvalidVaultKeyEnvelopeError());
	});

	test('disposed Vault Session keys cannot be used again', async () => {
		const passphrase = 'correct horse battery staple';
		const created = await VaultKeyEnvelope.create({
			passphrase,
			passphraseKdf,
		});
		const keyRing = await VaultKeyEnvelope.unlockWithPassphrase(
			created.publicState,
			passphrase,
		);

		keyRing.dispose();

		await expect(fingerprint(keyRing, 'sqlcipher')).rejects.toThrow(
			'Vault Session key ring is disposed',
		);
	});
});
