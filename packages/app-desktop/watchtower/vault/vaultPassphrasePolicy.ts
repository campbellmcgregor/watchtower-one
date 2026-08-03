import { createHash, randomBytes } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { performance } from 'perf_hooks';
import deriveArgon2id from './argon2id';
import { type PassphraseKdfParameters } from './vaultKeyEnvelope';

const minimumCodePoints = 12;
const standardMemoryKiB = 256 * 1024;
const constrainedMemoryKiB = 128 * 1024;
const parallelism = 4;
const maximumPasses = 32;
const calibrationTargetMilliseconds = 5_000;
const calibrationMessageBytes = 32;
const saltBytes = 16;
const tagLengthBytes = 32;

const blocklistDigestPrefixBytes = 12;
const blocklistEntries = 99_877;
const blocklistSha256 =
	'5226b85302d67068c431b3857b06cb5aaafb098a909cc027a07492047eecb7be';

export type VaultPassphraseMemoryProfile =
	'standard'|'qualified-constrained';

export type VaultPassphrasePolicyErrorCode =
	'compromised'|'too-short'|'unsupported-memory-profile';

export class VaultPassphrasePolicyError extends Error {

	public constructor(public readonly code: VaultPassphrasePolicyErrorCode) {
		let message: string;
		if (code === 'compromised') {
			message = 'Passphrase appears in the local compromised-password blocklist';
		} else if (code === 'too-short') {
			message =
				`Passphrase must contain at least ${minimumCodePoints} Unicode code points`;
		} else {
			message = 'Unsupported vault passphrase memory profile';
		}
		super(message);
		this.name = 'VaultPassphrasePolicyError';
	}
}

let blocklist: Buffer|undefined;

export const resolvePassphraseBlocklistPath = (
	moduleDirectory: string,
	pathExists: (path: string)=> boolean = existsSync,
) => {
	const sourceModulePath = join(
		moduleDirectory,
		'assets',
		'compromised-passphrases-v1.bin',
	);
	if (pathExists(sourceModulePath)) return sourceModulePath;
	return join(
		moduleDirectory,
		'watchtower',
		'vault',
		'assets',
		'compromised-passphrases-v1.bin',
	);
};

const loadBlocklist = () => {
	if (blocklist) return blocklist;

	const loaded = readFileSync(resolvePassphraseBlocklistPath(__dirname));
	if (
		loaded.byteLength !== blocklistEntries * blocklistDigestPrefixBytes ||
		createHash('sha256').update(loaded).digest('hex') !== blocklistSha256
	) {
		loaded.fill(0);
		throw new Error('Watchtower passphrase blocklist failed its integrity check');
	}
	blocklist = loaded;
	return blocklist;
};

const isCompromised = (normalizedPassphrase: string) => {
	const digest = createHash('sha256')
		.update(normalizedPassphrase, 'utf8')
		.digest();
	try {
		const prefix = digest.subarray(0, blocklistDigestPrefixBytes);
		const entries = loadBlocklist();
		let lower = 0;
		let upper = blocklistEntries - 1;
		while (lower <= upper) {
			const middle = lower + Math.floor((upper - lower) / 2);
			const comparison = Buffer.compare(
				prefix,
				entries.subarray(
					middle * blocklistDigestPrefixBytes,
					(middle + 1) * blocklistDigestPrefixBytes,
				),
			);
			if (comparison === 0) return true;
			if (comparison < 0) upper = middle - 1;
			else lower = middle + 1;
		}
		return false;
	} finally {
		digest.fill(0);
	}
};

const measurePasses = async (
	memoryKiB: number,
	passes: number,
	message: Buffer,
	nonce: Buffer,
): Promise<number> => {
	const startedAt = performance.now();
	const derivedKey = await deriveArgon2id({
		message,
		salt: nonce,
		parallelism,
		tagLengthBytes,
		memoryKiB,
		passes,
	});
	derivedKey.fill(0);
	return Math.max(performance.now() - startedAt, 1);
};

const calibrate = async (
	memoryProfile: VaultPassphraseMemoryProfile,
): Promise<PassphraseKdfParameters> => {
	const memoryKiB = memoryProfile === 'qualified-constrained'
		? constrainedMemoryKiB
		: standardMemoryKiB;
	const message = randomBytes(calibrationMessageBytes);
	const nonce = randomBytes(saltBytes);
	try {
		const onePassMilliseconds = await measurePasses(
			memoryKiB,
			1,
			message,
			nonce,
		);
		if (onePassMilliseconds >= calibrationTargetMilliseconds) {
			return { memoryKiB, parallelism, passes: 1 };
		}

		let previousAcceptedPasses = 0;
		let previousAcceptedMilliseconds = 0;
		let acceptedPasses = 1;
		let acceptedMilliseconds = onePassMilliseconds;
		let rejectedPasses: number|undefined;
		let rejectedMilliseconds: number|undefined;

		while (
			acceptedPasses < maximumPasses &&
			rejectedPasses !== acceptedPasses + 1
		) {
			let candidatePasses: number;
			if (
				rejectedPasses !== undefined &&
				rejectedMilliseconds !== undefined
			) {
				const interpolated = acceptedPasses + Math.floor(
					(calibrationTargetMilliseconds - acceptedMilliseconds) *
					(rejectedPasses - acceptedPasses) /
					(rejectedMilliseconds - acceptedMilliseconds),
				);
				candidatePasses = Math.max(
					acceptedPasses + 1,
					Math.min(rejectedPasses - 1, interpolated),
				);
			} else if (previousAcceptedPasses > 0) {
				const millisecondsPerPass =
					(acceptedMilliseconds - previousAcceptedMilliseconds) /
					(acceptedPasses - previousAcceptedPasses);
				const projected = acceptedPasses + Math.floor(
					(calibrationTargetMilliseconds - acceptedMilliseconds) /
					millisecondsPerPass,
				);
				candidatePasses = Number.isFinite(projected)
					? Math.max(
						acceptedPasses + 1,
						Math.min(maximumPasses, projected),
					)
					: acceptedPasses + 1;
			} else {
				candidatePasses = Math.max(2, Math.min(
					maximumPasses,
					Math.floor(
						calibrationTargetMilliseconds / acceptedMilliseconds,
					),
				));
			}

			const candidateMilliseconds = await measurePasses(
				memoryKiB,
				candidatePasses,
				message,
				nonce,
			);
			if (candidateMilliseconds <= calibrationTargetMilliseconds) {
				previousAcceptedPasses = acceptedPasses;
				previousAcceptedMilliseconds = acceptedMilliseconds;
				acceptedPasses = candidatePasses;
				acceptedMilliseconds = candidateMilliseconds;
			} else {
				rejectedPasses = candidatePasses;
				rejectedMilliseconds = candidateMilliseconds;
			}
		}

		return { memoryKiB, parallelism, passes: acceptedPasses };
	} finally {
		message.fill(0);
		nonce.fill(0);
	}
};

const calibrations = new Map<
VaultPassphraseMemoryProfile,
Promise<PassphraseKdfParameters>
>();

const calibratedParameters = async (
	memoryProfile: VaultPassphraseMemoryProfile,
) => {
	let calibration = calibrations.get(memoryProfile);
	if (!calibration) {
		calibration = calibrate(memoryProfile);
		calibrations.set(memoryProfile, calibration);
	}
	try {
		return { ...await calibration };
	} catch (error) {
		calibrations.delete(memoryProfile);
		throw error;
	}
};

const prepareForVaultCreation = async (
	passphrase: string,
	memoryProfile: VaultPassphraseMemoryProfile,
) => {
	if (
		memoryProfile !== 'standard' &&
		memoryProfile !== 'qualified-constrained'
	) {
		throw new VaultPassphrasePolicyError('unsupported-memory-profile');
	}
	const normalizedPassphrase = passphrase.normalize('NFC');
	if ([...normalizedPassphrase].length < minimumCodePoints) {
		throw new VaultPassphrasePolicyError('too-short');
	}
	if (isCompromised(normalizedPassphrase)) {
		throw new VaultPassphrasePolicyError('compromised');
	}
	return calibratedParameters(memoryProfile);
};

export default {
	prepareForVaultCreation,
};
