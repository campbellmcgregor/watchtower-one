import VaultPassphrasePolicy, {
	VaultPassphraseMemoryProfile,
	VaultPassphrasePolicyError,
} from './vaultPassphrasePolicy';

describe('VaultPassphrasePolicy', () => {
	test('rejects an exact compromised passphrase without a network lookup', async () => {
		await expect(VaultPassphrasePolicy.prepareForVaultCreation(
			'password1234',
			'standard',
		)).rejects.toEqual(new VaultPassphrasePolicyError('compromised'));
	});

	test('rejects a Watchtower-specific passphrase added to the offline corpus', async () => {
		await expect(VaultPassphrasePolicy.prepareForVaultCreation(
			'watchtower one',
			'standard',
		)).rejects.toEqual(new VaultPassphrasePolicyError('compromised'));
	});

	test('rejects fewer than 12 Unicode code points without composition rules', async () => {
		await expect(VaultPassphrasePolicy.prepareForVaultCreation(
			'🧭 🧭 🧭',
			'standard',
		)).rejects.toEqual(new VaultPassphrasePolicyError('too-short'));
	});

	test('calibrates the standard profile with bounded parameters', async () => {
		const parameters = await VaultPassphrasePolicy.prepareForVaultCreation(
			'four private atlas words',
			'standard',
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

	test('callers cannot mutate cached standard-profile parameters', async () => {
		const first = await VaultPassphrasePolicy.prepareForVaultCreation(
			'four private atlas words',
			'standard',
		);
		const calibratedPasses = first.passes;
		first.memoryKiB = 1;
		first.passes = 1;

		const second = await VaultPassphrasePolicy.prepareForVaultCreation(
			'four private atlas words',
			'standard',
		);

		expect(second.memoryKiB).toBe(256 * 1024);
		expect(second.passes).toBe(calibratedPasses);
		expect(second).not.toBe(first);
	});

	test('compares the complete passphrase rather than rejecting substrings', async () => {
		await expect(VaultPassphrasePolicy.prepareForVaultCreation(
			'a unique password1234 phrase',
			'standard',
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
			'standard',
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
