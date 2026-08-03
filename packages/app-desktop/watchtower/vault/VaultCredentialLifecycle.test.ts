import { createHash } from 'crypto';
import { fork } from 'child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import VaultCredentialLifecycle from './VaultCredentialLifecycle';
import VaultKeyEnvelope from './vaultKeyEnvelope';
import VaultKeyEnvelopeStore from './vaultKeyEnvelopeStore';
import VaultRetirementRegistry from './VaultRetirementRegistry';

// cspell:ignore sqlcipher

type CreationCrashPoint =
	'before-confirmation'|'pending-synced'|'committed-synced';
type RecoveryCrashPoint =
	'recovery-pending-synced'|'recovery-committed-synced';
type RecoverySecretCrashPoint =
	'recovery-secret-pending-synced'|'recovery-secret-committed-synced';

interface WorkerPhaseMessage {
	phase: CreationCrashPoint|RecoveryCrashPoint|RecoverySecretCrashPoint;
}

const killCreationAt = async (
	storeDirectory: string,
	crashPoint: CreationCrashPoint|RecoveryCrashPoint|RecoverySecretCrashPoint,
) => {
	const worker = fork(
		join(__dirname, 'VaultCredentialLifecycle.forcedTerminationWorker.js'),
		[storeDirectory, crashPoint],
		{
			execArgv: [],
			stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
		},
	);
	let stderr = '';
	worker.stderr!.on('data', chunk => {
		stderr += chunk.toString();
	});
	await new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(new Error(`Forced-termination worker timed out: ${stderr}`));
		}, 30_000);
		const fail = (error: Error) => {
			clearTimeout(timeout);
			reject(error);
		};
		worker.once('error', fail);
		worker.once('exit', code => {
			if (code !== null) {
				fail(new Error(`Worker exited before barrier (${code}): ${stderr}`));
			}
		});
		worker.on('message', (message: WorkerPhaseMessage) => {
			if (message.phase !== crashPoint) return;
			clearTimeout(timeout);
			resolve();
		});
	});
	worker.kill();
	await new Promise<void>(resolve => {
		if (worker.exitCode !== null || worker.signalCode !== null) {
			resolve();
		} else {
			worker.once('exit', () => resolve());
		}
	});
};

describe('VaultCredentialLifecycle', () => {
	let storeDirectory = '';

	beforeEach(async () => {
		storeDirectory = await mkdtemp(join(tmpdir(), 'watchtower-credential-lifecycle-'));
	});

	afterEach(async () => {
		await rm(storeDirectory, { recursive: true, force: true });
	});

	test('does not commit a vault until the complete Recovery Secret is confirmed', async () => {
		const passphrase = 'four private atlas words';
		const lifecycle = new VaultCredentialLifecycle(
			new VaultKeyEnvelopeStore(storeDirectory),
		);

		const begun = await lifecycle.beginCreate({
			passphrase,
			memoryProfile: 'qualified-constrained',
		});

		expect(begun.kind).toBe('recoveryConfirmationRequired');
		if (begun.kind !== 'recoveryConfirmationRequired') return;
		const beforeConfirmation = await new VaultCredentialLifecycle(
			new VaultKeyEnvelopeStore(storeDirectory),
		).unlockWithPassphrase(passphrase);
		expect(beforeConfirmation).toEqual({
			kind: 'rejected',
			reason: 'missingVault',
		});

		const wrongConfirmation = `${
			begun.recoverySecret.slice(0, -1)
		}${begun.recoverySecret.endsWith('0') ? '1' : '0'}`;
		await expect(lifecycle.confirmCreate({
			creationId: begun.creationId,
			recoverySecret: wrongConfirmation,
		})).resolves.toEqual({
			kind: 'rejected',
			reason: 'wrongCredential',
		});
		const afterWrongConfirmation = await new VaultCredentialLifecycle(
			new VaultKeyEnvelopeStore(storeDirectory),
		).unlockWithPassphrase(passphrase);
		expect(afterWrongConfirmation).toEqual({
			kind: 'rejected',
			reason: 'missingVault',
		});

		const confirmed = await lifecycle.confirmCreate({
			creationId: begun.creationId,
			recoverySecret: begun.recoverySecret,
		});
		expect(confirmed.kind).toBe('opened');
		if (confirmed.kind !== 'opened') return;
		const reopened = await new VaultCredentialLifecycle(
			new VaultKeyEnvelopeStore(storeDirectory),
		).unlockWithPassphrase(passphrase);
		expect(reopened.kind).toBe('opened');
		if (reopened.kind !== 'opened') {
			confirmed.keyRing.dispose();
			return;
		}
		try {
			const fingerprint = async (
				keyRing: typeof confirmed.keyRing,
			) => await keyRing.withDerivedKey('sqlcipher', key => {
				return createHash('sha256').update(key).digest('hex');
			});
			expect(await fingerprint(reopened.keyRing)).toBe(
				await fingerprint(confirmed.keyRing),
			);
		} finally {
			confirmed.keyRing.dispose();
			reopened.keyRing.dispose();
		}
	});

	test('a corrupt committed vault prevents creation and fails closed on unlock', async () => {
		await writeFile(
			join(storeDirectory, 'vault-key-envelope.json'),
			'{"incomplete":',
			{ encoding: 'utf8', mode: 0o600 },
		);
		const lifecycle = new VaultCredentialLifecycle(
			new VaultKeyEnvelopeStore(storeDirectory),
		);

		await expect(lifecycle.beginCreate({
			passphrase: 'four private atlas words',
			memoryProfile: 'qualified-constrained',
		})).resolves.toEqual({ kind: 'failedClosed' });
		await expect(lifecycle.unlockWithPassphrase(
			'four private atlas words',
		)).resolves.toEqual({ kind: 'failedClosed' });
	});

	test.each([
		['before-confirmation', 'missingVault'],
		['pending-synced', 'missingVault'],
		['committed-synced', 'opened'],
	] as const)(
		'forced termination at %s recovers to %s without plaintext fallback',
		async (crashPoint, expectedKind) => {
			await killCreationAt(storeDirectory, crashPoint);

			const restarted = await new VaultCredentialLifecycle(
				new VaultKeyEnvelopeStore(storeDirectory),
			).unlockWithPassphrase('forced termination test passphrase');
			if (expectedKind === 'opened') {
				expect(restarted.kind).toBe('opened');
				if (restarted.kind === 'opened') restarted.keyRing.dispose();
			} else {
				expect(restarted).toEqual({
					kind: 'rejected',
					reason: expectedKind,
				});
			}

			for (const fileName of await readdir(storeDirectory)) {
				const persisted = await readFile(join(storeDirectory, fileName));
				expect(persisted.toString('utf8')).not.toContain(
					'forced termination test passphrase',
				);
			}
		},
	);

	test('recovery Secret establishes a new passphrase without changing the vault key', async () => {
		const lifecycle = new VaultCredentialLifecycle(
			new VaultKeyEnvelopeStore(storeDirectory),
		);
		const begun = await lifecycle.beginCreate({
			passphrase: 'original private atlas words',
			memoryProfile: 'qualified-constrained',
		});
		expect(begun.kind).toBe('recoveryConfirmationRequired');
		if (begun.kind !== 'recoveryConfirmationRequired') return;
		const created = await lifecycle.confirmCreate({
			creationId: begun.creationId,
			recoverySecret: begun.recoverySecret,
		});
		expect(created.kind).toBe('opened');
		if (created.kind !== 'opened') return;
		const originalFingerprint = await created.keyRing.withDerivedKey(
			'sqlcipher',
			key => createHash('sha256').update(key).digest('hex'),
		);
		created.keyRing.dispose();

		const recovered = await lifecycle.recoverWithRecoverySecret({
			recoverySecret: begun.recoverySecret,
			newPassphrase: 'replacement private atlas words',
			memoryProfile: 'qualified-constrained',
		});
		expect(recovered.kind).toBe('opened');
		if (recovered.kind !== 'opened') return;
		try {
			expect(await recovered.keyRing.withDerivedKey(
				'sqlcipher',
				key => createHash('sha256').update(key).digest('hex'),
			)).toBe(originalFingerprint);
		} finally {
			recovered.keyRing.dispose();
		}

		await expect(lifecycle.unlockWithPassphrase(
			'original private atlas words',
		)).resolves.toEqual({
			kind: 'rejected',
			reason: 'wrongCredential',
		});
		const replacementUnlock = await lifecycle.unlockWithPassphrase(
			'replacement private atlas words',
		);
		expect(replacementUnlock.kind).toBe('opened');
		if (replacementUnlock.kind === 'opened') replacementUnlock.keyRing.dispose();
	});

	test.each([
		['recovery-pending-synced', 'original private atlas words'],
		['recovery-committed-synced', 'replacement private atlas words'],
	] as const)(
		'forced termination at %s leaves exactly one working passphrase',
		async (crashPoint, workingPassphrase) => {
			await killCreationAt(storeDirectory, crashPoint);

			const lifecycle = new VaultCredentialLifecycle(
				new VaultKeyEnvelopeStore(storeDirectory),
			);
			for (const passphrase of [
				'original private atlas words',
				'replacement private atlas words',
			]) {
				const unlocked = await lifecycle.unlockWithPassphrase(passphrase);
				if (passphrase === workingPassphrase) {
					expect(unlocked.kind).toBe('opened');
					if (unlocked.kind === 'opened') unlocked.keyRing.dispose();
				} else {
					expect(unlocked).toEqual({
						kind: 'rejected',
						reason: 'wrongCredential',
					});
				}
			}
		},
	);

	test('changes the passphrase and replaces the Recovery Secret by rewrapping only', async () => {
		const lifecycle = new VaultCredentialLifecycle(
			new VaultKeyEnvelopeStore(storeDirectory),
		);
		const begun = await lifecycle.beginCreate({
			passphrase: 'original private atlas words',
			memoryProfile: 'qualified-constrained',
		});
		if (begun.kind !== 'recoveryConfirmationRequired') {
			throw new Error('Expected vault creation to begin');
		}
		const created = await lifecycle.confirmCreate({
			creationId: begun.creationId,
			recoverySecret: begun.recoverySecret,
		});
		if (created.kind !== 'opened') throw new Error('Expected vault to open');
		const fingerprint = await created.keyRing.withDerivedKey(
			'sqlcipher',
			key => createHash('sha256').update(key).digest('hex'),
		);
		created.keyRing.dispose();

		const changed = await lifecycle.changePassphrase({
			currentPassphrase: 'original private atlas words',
			newPassphrase: 'replacement private atlas words',
			memoryProfile: 'qualified-constrained',
		});
		expect(changed.kind).toBe('opened');
		if (changed.kind === 'opened') changed.keyRing.dispose();
		await expect(lifecycle.unlockWithPassphrase(
			'original private atlas words',
		)).resolves.toEqual({ kind: 'rejected', reason: 'wrongCredential' });

		const replacement = await lifecycle.beginRecoverySecretReplacement({
			passphrase: 'replacement private atlas words',
		});
		expect(replacement.kind).toBe('recoveryConfirmationRequired');
		if (replacement.kind !== 'recoveryConfirmationRequired') return;
		await expect(lifecycle.confirmRecoverySecretReplacement({
			rotationId: replacement.rotationId,
			recoverySecret: `${replacement.recoverySecret.slice(0, -1)}${
				replacement.recoverySecret.endsWith('0') ? '1' : '0'
			}`,
		})).resolves.toEqual({ kind: 'rejected', reason: 'wrongCredential' });

		const oldState = await new VaultKeyEnvelopeStore(storeDirectory).loadCommitted();
		const oldRecovery = await VaultKeyEnvelope.unlockWithRecoverySecret(
			oldState,
			begun.recoverySecret,
		);
		oldRecovery.dispose();

		const replaced = await lifecycle.confirmRecoverySecretReplacement({
			rotationId: replacement.rotationId,
			recoverySecret: replacement.recoverySecret,
		});
		expect(replaced.kind).toBe('opened');
		if (replaced.kind !== 'opened') return;
		try {
			expect(await replaced.keyRing.withDerivedKey(
				'sqlcipher',
				key => createHash('sha256').update(key).digest('hex'),
			)).toBe(fingerprint);
		} finally {
			replaced.keyRing.dispose();
		}

		const newState = await new VaultKeyEnvelopeStore(storeDirectory).loadCommitted();
		await expect(VaultKeyEnvelope.unlockWithRecoverySecret(
			newState,
			begun.recoverySecret,
		)).rejects.toThrow();
		const newRecovery = await VaultKeyEnvelope.unlockWithRecoverySecret(
			newState,
			replacement.recoverySecret,
		);
		newRecovery.dispose();
	});

	test('authenticates irreversible retirement and rejects a restored committed envelope', async () => {
		const envelopeDirectory = join(storeDirectory, 'vault', 'envelope');
		await mkdir(envelopeDirectory, { recursive: true });
		const registry = new VaultRetirementRegistry(storeDirectory);
		const lifecycle = new VaultCredentialLifecycle(
			new VaultKeyEnvelopeStore(envelopeDirectory),
			registry,
		);
		const begun = await lifecycle.beginCreate({
			passphrase: 'original private atlas words',
			memoryProfile: 'qualified-constrained',
		});
		if (begun.kind !== 'recoveryConfirmationRequired') {
			throw new Error('Expected vault creation to begin');
		}
		const created = await lifecycle.confirmCreate({
			creationId: begun.creationId,
			recoverySecret: begun.recoverySecret,
		});
		if (created.kind !== 'opened') throw new Error('Expected vault to open');
		created.keyRing.dispose();
		const committedEnvelope = await readFile(
			join(envelopeDirectory, 'vault-key-envelope.json'),
		);

		await expect(lifecycle.retireWithPassphrase({
			passphrase: 'wrong private atlas words',
		})).resolves.toEqual({ kind: 'rejected', reason: 'wrongCredential' });
		const stillActive = await lifecycle.unlockWithPassphrase(
			'original private atlas words',
		);
		expect(stillActive.kind).toBe('opened');
		if (stillActive.kind === 'opened') stillActive.keyRing.dispose();

		await expect(lifecycle.retireWithPassphrase({
			passphrase: 'original private atlas words',
		})).resolves.toEqual({ kind: 'retired' });

		const restoreRetiredEnvelope = async () => {
			await mkdir(envelopeDirectory, { recursive: true });
			await writeFile(
				join(envelopeDirectory, 'vault-key-envelope.json'),
				committedEnvelope,
			);
			return new VaultCredentialLifecycle(
				new VaultKeyEnvelopeStore(envelopeDirectory),
				registry,
			);
		};
		await expect((await restoreRetiredEnvelope()).unlockWithPassphrase(
			'original private atlas words',
		)).resolves.toEqual({ kind: 'failedClosed' });
		await expect((await restoreRetiredEnvelope()).recoverWithRecoverySecret({
			recoverySecret: begun.recoverySecret,
			newPassphrase: 'replacement private atlas words',
			memoryProfile: 'qualified-constrained',
		})).resolves.toEqual({ kind: 'failedClosed' });
		await expect((await restoreRetiredEnvelope()).changePassphrase({
			currentPassphrase: 'original private atlas words',
			newPassphrase: 'replacement private atlas words',
			memoryProfile: 'qualified-constrained',
		})).resolves.toEqual({ kind: 'failedClosed' });
		await expect((await restoreRetiredEnvelope()).beginRecoverySecretReplacement({
			passphrase: 'original private atlas words',
		})).resolves.toEqual({ kind: 'failedClosed' });
	});

	test.each([
		['recovery-secret-pending-synced', 1],
		['recovery-secret-committed-synced', 2],
	] as const)(
		'forced termination at %s selects one committed recovery generation',
		async (crashPoint, expectedGeneration) => {
			await killCreationAt(storeDirectory, crashPoint);
			const store = new VaultKeyEnvelopeStore(storeDirectory);
			const committed = await store.loadCommitted();
			expect(committed.recovery.generation).toBe(expectedGeneration);
			const unlocked = await new VaultCredentialLifecycle(
				store,
			).unlockWithPassphrase('original private atlas words');
			expect(unlocked.kind).toBe('opened');
			if (unlocked.kind === 'opened') unlocked.keyRing.dispose();
		},
	);
});
