import VaultPassphrasePolicy, {
	VaultPassphraseMemoryProfile,
	VaultPassphrasePolicyError,
} from './vaultPassphrasePolicy';

describe('VaultPassphrasePolicy', () => {
	test('rejects an exact compromised passphrase without a network lookup', async () => {
		await expect(VaultPassphrasePolicy.prepareForVaultCreation(
			'password1234',
		)).rejects.toEqual(new VaultPassphrasePolicyError('compromised'));
	});

	test('rejects a Watchtower-specific passphrase added to the offline corpus', async () => {
		await expect(VaultPassphrasePolicy.prepareForVaultCreation(
			'watchtower one',
		)).rejects.toEqual(new VaultPassphrasePolicyError('compromised'));
	});

	test('rejects fewer than 12 Unicode code points without composition rules', async () => {
		await expect(VaultPassphrasePolicy.prepareForVaultCreation(
			'🧭 🧭 🧭',
		)).rejects.toEqual(new VaultPassphrasePolicyError('too-short'));
	});

	test('calibrates the standard profile with bounded parameters', async () => {
		const parameters = await VaultPassphrasePolicy.prepareForVaultCreation(
			'four private atlas words',
		);

		expect(parameters).toEqual({
			memoryKiB: 256 * 1024,
			parallelism: 4,
			passes: expect.any(Number),
		});
		expect(Number.isInteger(parameters.passes)).toBe(true);
		expect(parameters.passes).toBeGreaterThanOrEqual(1);
		expect(parameters.passes).toBeLessThanOrEqual(32);
	});

	test('compares the complete passphrase rather than rejecting substrings', async () => {
		await expect(VaultPassphrasePolicy.prepareForVaultCreation(
			'a unique password1234 phrase',
		)).resolves.toEqual(expect.objectContaining({
			memoryKiB: 256 * 1024,
		}));
	});

	test('requires an explicit qualified profile before using 128 MiB', async () => {
		const parameters = await VaultPassphrasePolicy.prepareForVaultCreation(
			'four private atlas words',
			'qualified-constrained',
		);

		expect(parameters).toEqual({
			memoryKiB: 128 * 1024,
			parallelism: 4,
			passes: expect.any(Number),
		});
		expect(Number.isInteger(parameters.passes)).toBe(true);
		expect(parameters.passes).toBeGreaterThanOrEqual(1);
		expect(parameters.passes).toBeLessThanOrEqual(32);
	});

	test('permits at least 128 Unicode code points', async () => {
		await expect(VaultPassphrasePolicy.prepareForVaultCreation(
			'🧭'.repeat(128),
		)).resolves.toEqual(expect.objectContaining({
			memoryKiB: 256 * 1024,
		}));
	});

	test('fails closed for an unknown memory profile', async () => {
		await expect(VaultPassphrasePolicy.prepareForVaultCreation(
			'four private atlas words',
			'automatic' as VaultPassphraseMemoryProfile,
		)).rejects.toThrow('Unsupported vault passphrase memory profile');
	});
});
