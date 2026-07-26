import { createHash } from 'crypto';
import VaultKeyEnvelope, {
	InvalidVaultKeyEnvelopeError,
	VaultKeyPurpose,
} from './vaultKeyEnvelope';

// cspell:ignore BAPT CLUSA Czhq Ehea EMBG ETOFT HJKMNP KYJR Ludb MFWZS Spzg sqlcipher

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

const asRecord = (value: unknown) => value as Record<string, unknown>;

describe('VaultKeyEnvelope', () => {
	test('opens the published Watchtower v1 compatibility vector', async () => {
		const vector = {
			recoverySecret: 'WT1-QGR6-1XXE-KYJR-1XDZ-04SD-4X7R-BZ4D-XM4Z-8XDD-H1AS-PF16-BAPT-JN6B-8AMD-V200',
			publicState: '{"format":"watchtower-vault-key-envelope","version":1,"vaultId":"9MU2PO5QOeyOYk1rcgY7Sw","activeGeneration":1,"passphrase":{"purpose":"passphrase","generation":1,"kdf":{"algorithm":"argon2id","version":19,"salt":"kJvEMBGJxiYvAriKBoSpzg","tagLength":32,"memoryKiB":131072,"parallelism":4,"passes":1},"wrappedKey":{"algorithm":"aes-256-gcm","authenticationTag":"2b1SS-c934kpT9gCLUSA0A","ciphertext":"6gDA_lSv4ruOFEheaHhDJOyItiFHLqMFWZS_hxCOd6M","nonce":"hElRwD2pQQlEIYvA"}},"recovery":{"purpose":"recovery","generation":1,"kdf":{"algorithm":"hkdf-sha256","salt":"CQp1pfGfMDEoJ-fJNyfCvA"},"wrappedKey":{"algorithm":"aes-256-gcm","authenticationTag":"BI8sbeCiXqAPtQV3qG2DFg","ciphertext":"1BB9AnX58k25tDtMmtAT5J4ETOFT-9boLudbP5wFgSU","nonce":"mrBCbCzhq69yDWK3"}}}',
			sqlcipherFingerprint: 'efa7a714992955b91e219ae17f59ccfc714d5727ae7e6b80235f0e084fea835a',
		};
		const publicState = VaultKeyEnvelope.parsePublicState(vector.publicState);
		const passphraseKeyRing = await VaultKeyEnvelope.unlockWithPassphrase(
			publicState,
			'published vector passphrase',
		);
		const recoveryKeyRing = await VaultKeyEnvelope.unlockWithRecoverySecret(
			publicState,
			vector.recoverySecret,
		);
		try {
			expect(await fingerprint(passphraseKeyRing, 'sqlcipher')).toBe(
				vector.sqlcipherFingerprint,
			);
			expect(await fingerprint(recoveryKeyRing, 'sqlcipher')).toBe(
				vector.sqlcipherFingerprint,
			);
		} finally {
			passphraseKeyRing.dispose();
			recoveryKeyRing.dispose();
		}
	});

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
			const purposes: VaultKeyPurpose[] = [
				'sqlcipher',
				'resource-content',
				'private-profile-data',
				'vault-metadata-authentication',
			];
			const firstFingerprints = await Promise.all(
				purposes.map(purpose => fingerprint(firstUnlock, purpose)),
			);
			const secondFingerprints = await Promise.all(
				purposes.map(purpose => fingerprint(secondUnlock, purpose)),
			);

			expect(firstFingerprints).toEqual(secondFingerprints);
			expect(new Set(firstFingerprints).size).toBe(purposes.length);
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

	test.each([
		['root', (state: unknown) => {
			asRecord(state).credentialHint = 'forbidden';
		}],
		['passphrase envelope', (state: unknown) => {
			asRecord(asRecord(state).passphrase).extra = true;
		}],
		['passphrase KDF', (state: unknown) => {
			const passphrase = asRecord(asRecord(state).passphrase);
			asRecord(passphrase.kdf).extra = true;
		}],
		['passphrase wrapper', (state: unknown) => {
			const passphrase = asRecord(asRecord(state).passphrase);
			asRecord(passphrase.wrappedKey).extra = true;
		}],
		['recovery envelope', (state: unknown) => {
			asRecord(asRecord(state).recovery).extra = true;
		}],
		['recovery KDF', (state: unknown) => {
			const recovery = asRecord(asRecord(state).recovery);
			asRecord(recovery.kdf).extra = true;
		}],
		['recovery wrapper', (state: unknown) => {
			const recovery = asRecord(asRecord(state).recovery);
			asRecord(recovery.wrappedKey).extra = true;
		}],
	])('unknown %s fields fail closed', async (_location, addUnknownField) => {
		const created = await VaultKeyEnvelope.create({
			passphrase: 'correct horse battery staple',
			passphraseKdf,
		});
		const untrustedState = JSON.parse(JSON.stringify(created.publicState));
		addUnknownField(untrustedState);

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
			'Vault Session key ring is disposed or the purpose is invalid',
		);
	});

	test('disposing an active key ring overwrites an in-flight derived key', async () => {
		const created = await VaultKeyEnvelope.create({
			passphrase: 'correct horse battery staple',
			passphraseKdf,
		});
		const keyRing = await VaultKeyEnvelope.unlockWithPassphrase(
			created.publicState,
			'correct horse battery staple',
		);
		let releaseOperation!: ()=> void;
		const holdOperation = new Promise<void>(resolve => {
			releaseOperation = resolve;
		});
		let observedKey!: Buffer;

		const operation = keyRing.withDerivedKey('sqlcipher', async key => {
			observedKey = key;
			await holdOperation;
		});
		keyRing.dispose();

		expect(observedKey.equals(Buffer.alloc(32))).toBe(true);
		releaseOperation();
		await operation;
	});

	test('unreviewed runtime key-purpose strings are rejected', async () => {
		const created = await VaultKeyEnvelope.create({
			passphrase: 'correct horse battery staple',
			passphraseKdf,
		});
		const keyRing = await VaultKeyEnvelope.unlockWithPassphrase(
			created.publicState,
			'correct horse battery staple',
		);
		try {
			await expect(keyRing.withDerivedKey(
				'unreviewed-purpose' as VaultKeyPurpose,
				(): void => undefined,
			)).rejects.toThrow(
				'Vault Session key ring is disposed or the purpose is invalid',
			);
		} finally {
			keyRing.dispose();
		}
	});
});
