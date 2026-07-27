import VaultCredentialLifecycle from './VaultCredentialLifecycle';
import VaultKeyEnvelopeStore, {
	VaultKeyEnvelopeDurabilityObserver,
	VaultKeyEnvelopeDurabilityPhase,
} from './vaultKeyEnvelopeStore';

type CreationCrashPoint =
	'before-confirmation'|'pending-synced'|'committed-synced';
type RecoveryCrashPoint =
	'recovery-pending-synced'|'recovery-committed-synced';
type RecoverySecretCrashPoint =
	'recovery-secret-pending-synced'|'recovery-secret-committed-synced';
type CrashPoint =
	CreationCrashPoint|RecoveryCrashPoint|RecoverySecretCrashPoint;

const waitForTermination = async (phase: CrashPoint) => {
	process.send!({ phase });
	await new Promise<void>(() => {});
};

const run = async () => {
	const storeDirectory = process.argv[2];
	const crashPoint = process.argv[3] as CrashPoint;
	if (
		!storeDirectory ||
		![
			'before-confirmation',
			'pending-synced',
			'committed-synced',
			'recovery-pending-synced',
			'recovery-committed-synced',
			'recovery-secret-pending-synced',
			'recovery-secret-committed-synced',
		].includes(crashPoint)
	) {
		throw new Error('Invalid forced-termination worker arguments');
	}

	let rotationPrefix = '';
	const observer: VaultKeyEnvelopeDurabilityObserver = {
		reached: async (phase: VaultKeyEnvelopeDurabilityPhase) => {
			const observedCrashPoint = `${rotationPrefix}${phase}` as CrashPoint;
			if (observedCrashPoint === crashPoint) {
				await waitForTermination(observedCrashPoint);
			}
		},
	};
	const lifecycle = new VaultCredentialLifecycle(
		VaultKeyEnvelopeStore.withDurabilityObserver(
			storeDirectory,
			observer,
		),
	);
	const begun = await lifecycle.beginCreate({
		passphrase: crashPoint.startsWith('recovery-') ?
			'original private atlas words' :
			'forced termination test passphrase',
		memoryProfile: 'qualified-constrained',
	});
	if (begun.kind !== 'recoveryConfirmationRequired') {
		throw new Error(`Vault creation did not begin: ${begun.kind}`);
	}
	if (crashPoint === 'before-confirmation') {
		await waitForTermination(crashPoint);
	}
	const confirmed = await lifecycle.confirmCreate({
		creationId: begun.creationId,
		recoverySecret: begun.recoverySecret,
	});
	if (confirmed.kind !== 'opened') {
		throw new Error(`Vault creation did not complete: ${confirmed.kind}`);
	}
	confirmed.keyRing.dispose();
	if (crashPoint.startsWith('recovery-secret-')) {
		const replacement = await lifecycle.beginRecoverySecretReplacement({
			passphrase: 'original private atlas words',
		});
		if (replacement.kind !== 'recoveryConfirmationRequired') {
			throw new Error(`Recovery replacement did not begin: ${replacement.kind}`);
		}
		rotationPrefix = 'recovery-secret-';
		const confirmedReplacement =
			await lifecycle.confirmRecoverySecretReplacement({
				rotationId: replacement.rotationId,
				recoverySecret: replacement.recoverySecret,
			});
		if (confirmedReplacement.kind === 'opened') {
			confirmedReplacement.keyRing.dispose();
		}
	} else if (crashPoint.startsWith('recovery-')) {
		rotationPrefix = 'recovery-';
		const recovered = await lifecycle.recoverWithRecoverySecret({
			recoverySecret: begun.recoverySecret,
			newPassphrase: 'replacement private atlas words',
			memoryProfile: 'qualified-constrained',
		});
		if (recovered.kind === 'opened') recovered.keyRing.dispose();
	}
	throw new Error(`Worker passed crash point: ${crashPoint}`);
};

void run().catch(error => {
	process.stderr.write(`${(error as Error).message}\n`);
	process.exitCode = 1;
});
