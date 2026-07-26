import { createHash, randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { performance } from 'perf_hooks';
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

interface NodeArgon2Parameters {
	message: Buffer;
	nonce: Buffer;
	parallelism: number;
	tagLength: number;
	memory: number;
	passes: number;
}

type NodeArgon2 = (
	algorithm: 'argon2id',
	parameters: NodeArgon2Parameters,
	callback: (error: Error|null, derivedKey: Buffer)=> void,
)=> void;

const { argon2 } = require('crypto') as { argon2: NodeArgon2 };

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

const loadBlocklist = () => {
	if (blocklist) return blocklist;

	const loaded = readFileSync(join(
		__dirname,
		'assets',
		'compromised-passphrases-v1.bin',
	));
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

const measurePasses = (
	memoryKiB: number,
	passes: number,
	message: Buffer,
	nonce: Buffer,
): Promise<number> => {
	const startedAt = performance.now();
	return new Promise((resolve, reject) => {
		const finish = (error: Error|null, derivedKey?: Buffer) => {
			derivedKey?.fill(0);
			if (error) reject(error);
			else resolve(Math.max(performance.now() - startedAt, 1));
		};
		try {
			argon2('argon2id', {
				message,
				nonce,
				parallelism,
				tagLength: tagLengthBytes,
				memory: memoryKiB,
				passes,
			}, finish);
		} catch (error) {
			finish(error as Error);
		}
	});
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

		const candidatePasses = Math.max(2, Math.min(
			maximumPasses,
			Math.floor(
				calibrationTargetMilliseconds / onePassMilliseconds,
			),
		));
		const candidateMilliseconds = await measurePasses(
			memoryKiB,
			candidatePasses,
			message,
			nonce,
		);
		if (
			candidatePasses === maximumPasses &&
			candidateMilliseconds <= calibrationTargetMilliseconds
		) {
			return { memoryKiB, parallelism, passes: maximumPasses };
		}

		const millisecondsPerAdditionalPass =
			(candidateMilliseconds - onePassMilliseconds) /
			(candidatePasses - 1);
		let projectedPasses = Number.isFinite(millisecondsPerAdditionalPass) &&
			millisecondsPerAdditionalPass > 0
			? Math.floor(
				1 +
				(calibrationTargetMilliseconds - onePassMilliseconds) /
				millisecondsPerAdditionalPass,
			)
			: Math.floor(
				candidatePasses *
				calibrationTargetMilliseconds /
				candidateMilliseconds,
			);
		projectedPasses = Math.max(1, Math.min(maximumPasses, projectedPasses));
		if (projectedPasses === candidatePasses) {
			const passes = candidateMilliseconds <= calibrationTargetMilliseconds
				? candidatePasses
				: 1;
			return { memoryKiB, parallelism, passes };
		}

		const projectedMilliseconds = await measurePasses(
			memoryKiB,
			projectedPasses,
			message,
			nonce,
		);
		const acceptedCandidates = [
			{ passes: 1, milliseconds: onePassMilliseconds },
			{ passes: candidatePasses, milliseconds: candidateMilliseconds },
			{ passes: projectedPasses, milliseconds: projectedMilliseconds },
		].filter(candidate => {
			return candidate.milliseconds <= calibrationTargetMilliseconds;
		});
		const passes = Math.max(...acceptedCandidates.map(candidate => {
			return candidate.passes;
		}));
		return { memoryKiB, parallelism, passes };
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
		return await calibration;
	} catch (error) {
		calibrations.delete(memoryProfile);
		throw error;
	}
};

const prepareForVaultCreation = async (
	passphrase: string,
	memoryProfile: VaultPassphraseMemoryProfile = 'standard',
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
