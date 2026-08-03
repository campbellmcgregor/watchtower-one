import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { fork } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import type { VaultSessionKeyRing } from './vaultKeyEnvelope';
import VaultRetirementRegistry, {
	VaultRetiredError,
	VaultRetirementDurabilityPhase,
} from './VaultRetirementRegistry';

describe('VaultRetirementRegistry', () => {
	let userDataDirectory = '';
	const vaultId = 'AAAAAAAAAAAAAAAAAAAAAA';
	const metadataKeyCanary = Buffer.alloc(32, 0x5a);
	const keyRing: VaultSessionKeyRing = {
		withDerivedKey: async (purpose, operation) => {
			expect(purpose).toBe('vault-metadata-authentication');
			return operation(Buffer.from(metadataKeyCanary));
		},
		dispose: jest.fn(),
	};

	beforeEach(async () => {
		userDataDirectory = await mkdtemp(join(tmpdir(), 'watchtower-retirement-'));
	});

	afterEach(async () => {
		await rm(userDataDirectory, { recursive: true, force: true });
	});

	test('durably retires one vault before deleting it and resumes cleanup after envelope restoration', async () => {
		const vaultDirectory = join(userDataDirectory, 'vault');
		const encryptedProfileCanary = 'ENCRYPTED-PROFILE-BYTES';
		await mkdir(join(vaultDirectory, 'envelope'), { recursive: true });
		await writeFile(
			join(vaultDirectory, 'profile.sqlite'),
			encryptedProfileCanary,
			'utf8',
		);

		const registry = new VaultRetirementRegistry(userDataDirectory);
		await expect(registry.assertActive(vaultId)).resolves.toBeUndefined();
		await expect(registry.retire(vaultId, keyRing)).resolves.toEqual({
			kind: 'retired',
		});
		await expect(access(vaultDirectory)).rejects.toMatchObject({ code: 'ENOENT' });

		const markerPath = join(
			userDataDirectory,
			'retired-vaults',
			`${vaultId}.json`,
		);
		const marker = await readFile(markerPath, 'utf8');
		expect(marker).not.toContain(encryptedProfileCanary);
		expect(marker).not.toContain(metadataKeyCanary.toString('hex'));

		await mkdir(join(vaultDirectory, 'envelope'), { recursive: true });
		await writeFile(
			join(vaultDirectory, 'profile.sqlite'),
			encryptedProfileCanary,
			'utf8',
		);
		await expect(registry.assertActive(vaultId)).rejects.toBeInstanceOf(
			VaultRetiredError,
		);
		await expect(access(vaultDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
	});

	test.each([
		['marker-pending-synced', false],
		['marker-committed-synced', true],
		['vault-removed', true],
	] as const)(
		'forced termination at %s exposes only the active vault or durable retirement',
		async (crashPoint, retired) => {
			const worker = fork(
				join(__dirname, 'VaultRetirementRegistry.forcedTerminationWorker.js'),
				[userDataDirectory, crashPoint],
				{ execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
			);
			let stderr = '';
			worker.stderr!.on('data', chunk => {
				stderr += chunk.toString();
			});
			await new Promise<void>((resolveBarrier, rejectBarrier) => {
				const timeout = setTimeout(() => {
					rejectBarrier(new Error(`Retirement worker timed out: ${stderr}`));
				}, 10_000);
				worker.once('error', rejectBarrier);
				worker.once('exit', code => {
					if (code !== null) {
						rejectBarrier(new Error(`Retirement worker exited at ${code}: ${stderr}`));
					}
				});
				worker.on('message', (message: { phase: VaultRetirementDurabilityPhase }) => {
					if (message.phase !== crashPoint) return;
					clearTimeout(timeout);
					resolveBarrier();
				});
			});
			worker.kill();
			await new Promise<void>(resolveExit => {
				if (worker.exitCode !== null || worker.signalCode !== null) resolveExit();
				else worker.once('exit', () => resolveExit());
			});

			const registry = new VaultRetirementRegistry(userDataDirectory);
			if (retired) {
				await expect(registry.assertActive(vaultId)).rejects.toBeInstanceOf(
					VaultRetiredError,
				);
				await expect(access(join(userDataDirectory, 'vault'))).rejects.toMatchObject({
					code: 'ENOENT',
				});
			} else {
				await expect(registry.assertActive(vaultId)).resolves.toBeUndefined();
				await expect(access(join(
					userDataDirectory,
					'vault',
					'profile.sqlite',
				))).resolves.toBeUndefined();
			}
		},
	);
});
