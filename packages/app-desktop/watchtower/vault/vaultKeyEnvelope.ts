import {
	createCipheriv,
	createDecipheriv,
	createHash,
	hkdfSync,
	randomBytes,
	timingSafeEqual,
} from 'crypto';
import deriveArgon2id from './argon2id';

// cspell:ignore ABCDEFGHJKMNPQRSTVWXYZ sqlcipher

const localVaultKeyBytes = 32;
const vaultIdentifierBytes = 16;
const saltBytes = 16;
const nonceBytes = 12;
const authenticationTagBytes = 16;
const recoverySecretLength = 32;
const recoveryChecksumBytes = 5;
const recoverySecretPrefix = 'WT1';
const base32Alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const minimumMemoryKiB = 128 * 1024;
const maximumMemoryKiB = 1024 * 1024;
const maximumPasses = 32;
const maximumParallelism = 16;
export const maximumVaultKeyEnvelopePublicStateBytes = 64 * 1024;

export type VaultKeyPurpose =
	'sqlcipher'|
	'resource-content'|
	'private-profile-data'|
	'vault-metadata-authentication';

const vaultKeyPurposes = new Set<VaultKeyPurpose>([
	'sqlcipher',
	'resource-content',
	'private-profile-data',
	'vault-metadata-authentication',
]);

export interface PassphraseKdfParameters {
	memoryKiB: number;
	parallelism: number;
	passes: number;
}

interface StoredPassphraseKdfParameters extends PassphraseKdfParameters {
	algorithm: 'argon2id';
	salt: string;
	tagLength: 32;
	version: 19;
}

interface WrappedLocalVaultKey {
	algorithm: 'aes-256-gcm';
	authenticationTag: string;
	ciphertext: string;
	nonce: string;
}

interface PassphraseKeyEnvelope {
	generation: number;
	kdf: StoredPassphraseKdfParameters;
	purpose: 'passphrase';
	wrappedKey: WrappedLocalVaultKey;
}

interface StoredRecoveryKdfParameters {
	algorithm: 'hkdf-sha256';
	salt: string;
}

interface RecoveryKeyEnvelope {
	generation: number;
	kdf: StoredRecoveryKdfParameters;
	purpose: 'recovery';
	wrappedKey: WrappedLocalVaultKey;
}

export interface VaultKeyEnvelopePublicState {
	activeGeneration: number;
	format: 'watchtower-vault-key-envelope';
	passphrase: PassphraseKeyEnvelope;
	recovery: RecoveryKeyEnvelope;
	vaultId: string;
	version: 1;
}

interface CreateVaultKeyEnvelopeOptions {
	passphrase: string;
	passphraseKdf: PassphraseKdfParameters;
}

interface CreateVaultKeyEnvelopeResult {
	publicState: VaultKeyEnvelopePublicState;
	recoverySecret: string;
}

interface ReplaceRecoverySecretResult {
	publicState: VaultKeyEnvelopePublicState;
	recoverySecret: string;
}

export class InvalidVaultKeyEnvelopeError extends Error {

	public constructor() {
		super('Vault key envelope is invalid or the credential is incorrect');
		this.name = 'InvalidVaultKeyEnvelopeError';
	}
}

const isIntegerInRange = (value: unknown, minimum: number, maximum: number) => {
	return (
		typeof value === 'number' &&
		Number.isSafeInteger(value) &&
		value >= minimum &&
		value <= maximum
	);
};

const validatePassphraseKdf = (parameters: PassphraseKdfParameters) => {
	if (
		!isIntegerInRange(parameters.memoryKiB, minimumMemoryKiB, maximumMemoryKiB) ||
		!isIntegerInRange(parameters.parallelism, 1, maximumParallelism) ||
		!isIntegerInRange(parameters.passes, 1, maximumPasses)
	) {
		throw new InvalidVaultKeyEnvelopeError();
	}
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const hasExactKeys = (value: Record<string, unknown>, keys: string[]) => {
	const actualKeys = Object.keys(value).sort();
	const expectedKeys = [...keys].sort();
	return (
		actualKeys.length === expectedKeys.length &&
		actualKeys.every((key, index) => key === expectedKeys[index])
	);
};

const readBase64Url = (
	value: unknown,
	expectedBytes: number,
) => {
	if (
		typeof value !== 'string' ||
		!/^[A-Za-z0-9_-]+$/.test(value)
	) {
		throw new InvalidVaultKeyEnvelopeError();
	}
	const decoded = Buffer.from(value, 'base64url');
	if (
		decoded.byteLength !== expectedBytes ||
		decoded.toString('base64url') !== value
	) {
		decoded.fill(0);
		throw new InvalidVaultKeyEnvelopeError();
	}
	decoded.fill(0);
	return value;
};

const readWrappedKey = (value: unknown): WrappedLocalVaultKey => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'algorithm',
			'authenticationTag',
			'ciphertext',
			'nonce',
		]) ||
		value.algorithm !== 'aes-256-gcm'
	) {
		throw new InvalidVaultKeyEnvelopeError();
	}
	return {
		algorithm: value.algorithm,
		authenticationTag: readBase64Url(
			value.authenticationTag,
			authenticationTagBytes,
		),
		ciphertext: readBase64Url(value.ciphertext, localVaultKeyBytes),
		nonce: readBase64Url(value.nonce, nonceBytes),
	};
};

const validatePublicState = (value: unknown): VaultKeyEnvelopePublicState => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'activeGeneration',
			'format',
			'passphrase',
			'recovery',
			'vaultId',
			'version',
		]) ||
		value.format !== 'watchtower-vault-key-envelope' ||
		value.version !== 1 ||
		!isIntegerInRange(value.activeGeneration, 1, Number.MAX_SAFE_INTEGER) ||
		!isRecord(value.passphrase) ||
		!hasExactKeys(value.passphrase, [
			'generation',
			'kdf',
			'purpose',
			'wrappedKey',
		]) ||
		value.passphrase.purpose !== 'passphrase' ||
		!isIntegerInRange(
			value.passphrase.generation,
			1,
			value.activeGeneration as number,
		) ||
		!isRecord(value.passphrase.kdf) ||
		!hasExactKeys(value.passphrase.kdf, [
			'algorithm',
			'memoryKiB',
			'parallelism',
			'passes',
			'salt',
			'tagLength',
			'version',
		]) ||
		value.passphrase.kdf.algorithm !== 'argon2id' ||
		value.passphrase.kdf.version !== 19 ||
		value.passphrase.kdf.tagLength !== 32 ||
		!isRecord(value.recovery) ||
		!hasExactKeys(value.recovery, [
			'generation',
			'kdf',
			'purpose',
			'wrappedKey',
		]) ||
		value.recovery.purpose !== 'recovery' ||
		!isIntegerInRange(
			value.recovery.generation,
			1,
			value.activeGeneration as number,
		) ||
		!isRecord(value.recovery.kdf) ||
		!hasExactKeys(value.recovery.kdf, [
			'algorithm',
			'salt',
		]) ||
		value.recovery.kdf.algorithm !== 'hkdf-sha256'
	) {
		throw new InvalidVaultKeyEnvelopeError();
	}
	if (
		value.passphrase.generation !== value.activeGeneration &&
		value.recovery.generation !== value.activeGeneration
	) {
		throw new InvalidVaultKeyEnvelopeError();
	}

	const passphraseKdf: StoredPassphraseKdfParameters = {
		algorithm: value.passphrase.kdf.algorithm,
		version: value.passphrase.kdf.version,
		salt: readBase64Url(value.passphrase.kdf.salt, saltBytes),
		tagLength: value.passphrase.kdf.tagLength,
		memoryKiB: value.passphrase.kdf.memoryKiB as number,
		parallelism: value.passphrase.kdf.parallelism as number,
		passes: value.passphrase.kdf.passes as number,
	};
	validatePassphraseKdf(passphraseKdf);

	return {
		format: value.format,
		version: value.version,
		vaultId: readBase64Url(value.vaultId, vaultIdentifierBytes),
		activeGeneration: value.activeGeneration as number,
		passphrase: {
			purpose: value.passphrase.purpose,
			generation: value.passphrase.generation as number,
			kdf: passphraseKdf,
			wrappedKey: readWrappedKey(value.passphrase.wrappedKey),
		},
		recovery: {
			purpose: value.recovery.purpose,
			generation: value.recovery.generation as number,
			kdf: {
				algorithm: value.recovery.kdf.algorithm,
				salt: readBase64Url(value.recovery.kdf.salt, saltBytes),
			},
			wrappedKey: readWrappedKey(value.recovery.wrappedKey),
		},
	};
};

const parsePublicState = (serialized: string): VaultKeyEnvelopePublicState => {
	try {
		if (
			typeof serialized !== 'string' ||
			Buffer.byteLength(serialized, 'utf8') >
			maximumVaultKeyEnvelopePublicStateBytes
		) {
			throw new InvalidVaultKeyEnvelopeError();
		}
		return validatePublicState(JSON.parse(serialized));
	} catch (error) {
		if (error instanceof InvalidVaultKeyEnvelopeError) throw error;
		throw new InvalidVaultKeyEnvelopeError();
	}
};

const inspectPublicState = (serialized: string) => {
	const publicState = parsePublicState(serialized);
	return {
		format: publicState.format,
		version: publicState.version,
		vaultId: publicState.vaultId,
		activeGeneration: publicState.activeGeneration,
		passphraseKdf: {
			algorithm: publicState.passphrase.kdf.algorithm,
			version: publicState.passphrase.kdf.version,
			memoryKiB: publicState.passphrase.kdf.memoryKiB,
			parallelism: publicState.passphrase.kdf.parallelism,
			passes: publicState.passphrase.kdf.passes,
		},
		recoveryAvailable: true,
	};
};

const derivePassphraseArgon2id = async (
	passphrase: string,
	parameters: StoredPassphraseKdfParameters,
): Promise<Buffer> => {
	const message = Buffer.from(passphrase.normalize('NFC'), 'utf8');
	const salt = Buffer.from(parameters.salt, 'base64url');
	try {
		return await deriveArgon2id({
			message,
			salt,
			parallelism: parameters.parallelism,
			tagLengthBytes: parameters.tagLength,
			memoryKiB: parameters.memoryKiB,
			passes: parameters.passes,
		});
	} finally {
		message.fill(0);
		salt.fill(0);
	}
};

const derivePassphraseWrappingKey = (
	argon2idOutput: Buffer,
	kdf: StoredPassphraseKdfParameters,
) => {
	const derivedKey = hkdfSync(
		'sha256',
		argon2idOutput,
		Buffer.from(kdf.salt, 'base64url'),
		Buffer.from('watchtower-one/v1/passphrase-key-encryption', 'utf8'),
		localVaultKeyBytes,
	);
	return Buffer.isBuffer(derivedKey) ? derivedKey : Buffer.from(derivedKey);
};

const encodeBase32 = (value: Buffer) => {
	let bits = 0;
	let bitCount = 0;
	let encoded = '';
	for (const byte of value) {
		bits = (bits << 8) | byte;
		bitCount += 8;
		while (bitCount >= 5) {
			bitCount -= 5;
			encoded += base32Alphabet[(bits >>> bitCount) & 31];
		}
	}
	if (bitCount) encoded += base32Alphabet[(bits << (5 - bitCount)) & 31];
	return encoded;
};

const decodeBase32 = (encoded: string) => {
	let bits = 0;
	let bitCount = 0;
	const decoded = Buffer.alloc(Math.floor(encoded.length * 5 / 8));
	let decodedOffset = 0;
	for (const character of encoded) {
		const value = base32Alphabet.indexOf(character);
		if (value < 0) {
			decoded.fill(0);
			throw new InvalidVaultKeyEnvelopeError();
		}
		bits = (bits << 5) | value;
		bitCount += 5;
		if (bitCount >= 8) {
			bitCount -= 8;
			decoded[decodedOffset++] = (bits >>> bitCount) & 255;
		}
	}
	return decoded;
};

const recoverySecretChecksum = (secret: Buffer) => {
	const digest = createHash('sha256')
		.update('watchtower-one/v1/recovery-secret-checksum\0', 'utf8')
		.update(secret)
		.digest();
	try {
		return Buffer.from(digest.subarray(0, recoveryChecksumBytes));
	} finally {
		digest.fill(0);
	}
};

const encodeRecoverySecret = (secret: Buffer) => {
	const checksum = recoverySecretChecksum(secret);
	const payload = Buffer.concat([secret, checksum]);
	checksum.fill(0);
	try {
		const encoded = encodeBase32(payload);
		return `${recoverySecretPrefix}-${
			encoded.match(/.{1,4}/g)!.join('-')
		}`;
	} finally {
		payload.fill(0);
	}
};

const decodeRecoverySecret = (value: string) => {
	const normalized = value.toUpperCase().replace(/-/g, '');
	if (!normalized.startsWith(recoverySecretPrefix)) {
		throw new InvalidVaultKeyEnvelopeError();
	}
	const encoded = normalized.slice(recoverySecretPrefix.length);
	const decoded = decodeBase32(encoded);
	if (decoded.byteLength !== recoverySecretLength + recoveryChecksumBytes) {
		decoded.fill(0);
		throw new InvalidVaultKeyEnvelopeError();
	}
	if (encodeBase32(decoded) !== encoded) {
		decoded.fill(0);
		throw new InvalidVaultKeyEnvelopeError();
	}
	const secret = Buffer.from(decoded.subarray(0, recoverySecretLength));
	const checksum = decoded.subarray(recoverySecretLength);
	const expectedChecksum = recoverySecretChecksum(secret);
	const valid = timingSafeEqual(checksum, expectedChecksum);
	decoded.fill(0);
	expectedChecksum.fill(0);
	if (!valid) {
		secret.fill(0);
		throw new InvalidVaultKeyEnvelopeError();
	}
	return secret;
};

const deriveRecoveryWrappingKey = (
	recoverySecret: Buffer,
	kdf: StoredRecoveryKdfParameters,
) => {
	const derivedKey = hkdfSync(
		'sha256',
		recoverySecret,
		Buffer.from(kdf.salt, 'base64url'),
		Buffer.from('watchtower-one/v1/recovery-key-encryption', 'utf8'),
		localVaultKeyBytes,
	);
	return Buffer.isBuffer(derivedKey) ? derivedKey : Buffer.from(derivedKey);
};

const envelopeAuthenticatedData = (
	vaultId: string,
	envelope:
		Omit<PassphraseKeyEnvelope, 'wrappedKey'>|
		Omit<RecoveryKeyEnvelope, 'wrappedKey'>,
) => {
	return Buffer.from(JSON.stringify({
		format: 'watchtower-vault-key-envelope',
		version: 1,
		vaultId,
		activeGeneration: envelope.generation,
		purpose: envelope.purpose,
		generation: envelope.generation,
		kdf: envelope.kdf,
	}), 'utf8');
};

const wrapLocalVaultKey = (
	localVaultKey: Buffer,
	wrappingKey: Buffer,
	authenticatedData: Buffer,
): WrappedLocalVaultKey => {
	const nonce = randomBytes(nonceBytes);
	const cipher = createCipheriv('aes-256-gcm', wrappingKey, nonce, {
		authTagLength: authenticationTagBytes,
	});
	cipher.setAAD(authenticatedData);
	const ciphertext = Buffer.concat([cipher.update(localVaultKey), cipher.final()]);
	return {
		algorithm: 'aes-256-gcm',
		authenticationTag: cipher.getAuthTag().toString('base64url'),
		ciphertext: ciphertext.toString('base64url'),
		nonce: nonce.toString('base64url'),
	};
};

const unwrapLocalVaultKey = (
	wrappedKey: WrappedLocalVaultKey,
	wrappingKey: Buffer,
	authenticatedData: Buffer,
) => {
	try {
		const decipher = createDecipheriv(
			'aes-256-gcm',
			wrappingKey,
			Buffer.from(wrappedKey.nonce, 'base64url'),
			{ authTagLength: authenticationTagBytes },
		);
		decipher.setAAD(authenticatedData);
		decipher.setAuthTag(Buffer.from(wrappedKey.authenticationTag, 'base64url'));
		const ciphertext = Buffer.from(wrappedKey.ciphertext, 'base64url');
		let updated: Buffer|undefined;
		let final: Buffer|undefined;
		let localVaultKey: Buffer;
		try {
			updated = decipher.update(ciphertext);
			final = decipher.final();
			localVaultKey = Buffer.concat([updated, final]);
		} finally {
			ciphertext.fill(0);
			updated?.fill(0);
			final?.fill(0);
		}
		if (localVaultKey.byteLength !== localVaultKeyBytes) {
			localVaultKey.fill(0);
			throw new InvalidVaultKeyEnvelopeError();
		}
		return localVaultKey;
	} catch (error) {
		if (error instanceof InvalidVaultKeyEnvelopeError) throw error;
		throw new InvalidVaultKeyEnvelopeError();
	}
};

export interface VaultSessionKeyRing {
	withDerivedKey<T>(
		purpose: VaultKeyPurpose,
		operation: (key: Buffer)=> T|Promise<T>,
	): Promise<T>;
	dispose(): void;
}

class VaultSessionKeyRingImpl implements VaultSessionKeyRing {

	private disposed_ = false;
	private readonly activeDerivedKeys_ = new Set<Buffer>();

	public constructor(
		private readonly localVaultKey_: Buffer,
		private readonly vaultId_: string,
	) {}

	public async withDerivedKey<T>(
		purpose: VaultKeyPurpose,
		operation: (key: Buffer)=> T|Promise<T>,
	): Promise<T> {
		if (
			this.disposed_ ||
			!vaultKeyPurposes.has(purpose)
		) {
			throw new Error('Vault Session key ring is disposed or the purpose is invalid');
		}
		const derivedKey = hkdfSync(
			'sha256',
			this.localVaultKey_,
			Buffer.from(this.vaultId_, 'base64url'),
			Buffer.from(`watchtower-one/v1/${purpose}`, 'utf8'),
			localVaultKeyBytes,
		);
		const key = Buffer.isBuffer(derivedKey) ? derivedKey : Buffer.from(derivedKey);
		this.activeDerivedKeys_.add(key);
		if (this.disposed_) {
			key.fill(0);
			this.activeDerivedKeys_.delete(key);
			throw new Error('Vault Session key ring is disposed or the purpose is invalid');
		}
		try {
			return await operation(key);
		} finally {
			key.fill(0);
			this.activeDerivedKeys_.delete(key);
		}
	}

	public dispose() {
		if (this.disposed_) return;
		this.disposed_ = true;
		this.localVaultKey_.fill(0);
		for (const key of this.activeDerivedKeys_) key.fill(0);
	}

	public async createPassphraseReplacement(
		publicState: VaultKeyEnvelopePublicState,
		passphrase: string,
		passphraseKdf: PassphraseKdfParameters,
	): Promise<VaultKeyEnvelopePublicState> {
		if (
			this.disposed_ ||
			publicState.vaultId !== this.vaultId_ ||
			publicState.activeGeneration >= Number.MAX_SAFE_INTEGER
		) {
			throw new InvalidVaultKeyEnvelopeError();
		}
		validatePassphraseKdf(passphraseKdf);

		const generation = publicState.activeGeneration + 1;
		const kdf: StoredPassphraseKdfParameters = {
			algorithm: 'argon2id',
			version: 19,
			salt: randomBytes(saltBytes).toString('base64url'),
			tagLength: 32,
			...passphraseKdf,
		};
		const passphraseEnvelope = {
			purpose: 'passphrase',
			generation,
			kdf,
		} as const;
		const argon2idOutput = await derivePassphraseArgon2id(passphrase, kdf);
		let wrappingKey: Buffer|undefined;
		try {
			wrappingKey = derivePassphraseWrappingKey(argon2idOutput, kdf);
			return {
				...publicState,
				activeGeneration: generation,
				passphrase: {
					...passphraseEnvelope,
					wrappedKey: wrapLocalVaultKey(
						this.localVaultKey_,
						wrappingKey,
						envelopeAuthenticatedData(this.vaultId_, passphraseEnvelope),
					),
				},
			};
		} finally {
			argon2idOutput.fill(0);
			wrappingKey?.fill(0);
		}
	}

	public createRecoveryReplacement(
		publicState: VaultKeyEnvelopePublicState,
	): ReplaceRecoverySecretResult {
		if (
			this.disposed_ ||
			publicState.vaultId !== this.vaultId_ ||
			publicState.activeGeneration >= Number.MAX_SAFE_INTEGER
		) {
			throw new InvalidVaultKeyEnvelopeError();
		}

		const generation = publicState.activeGeneration + 1;
		const recoverySecretBytes = randomBytes(recoverySecretLength);
		let wrappingKey: Buffer|undefined;
		try {
			const recoverySecret = encodeRecoverySecret(recoverySecretBytes);
			const kdf: StoredRecoveryKdfParameters = {
				algorithm: 'hkdf-sha256',
				salt: randomBytes(saltBytes).toString('base64url'),
			};
			const recoveryEnvelope = {
				purpose: 'recovery',
				generation,
				kdf,
			} as const;
			wrappingKey = deriveRecoveryWrappingKey(recoverySecretBytes, kdf);
			return {
				recoverySecret,
				publicState: {
					...publicState,
					activeGeneration: generation,
					recovery: {
						...recoveryEnvelope,
						wrappedKey: wrapLocalVaultKey(
							this.localVaultKey_,
							wrappingKey,
							envelopeAuthenticatedData(this.vaultId_, recoveryEnvelope),
						),
					},
				},
			};
		} finally {
			recoverySecretBytes.fill(0);
			wrappingKey?.fill(0);
		}
	}
}

const create = async (
	options: CreateVaultKeyEnvelopeOptions,
): Promise<CreateVaultKeyEnvelopeResult> => {
	if ([...options.passphrase.normalize('NFC')].length < 12) {
		throw new Error('Passphrase must contain at least 12 Unicode code points');
	}
	validatePassphraseKdf(options.passphraseKdf);

	const localVaultKey = randomBytes(localVaultKeyBytes);
	let wrappingKey: Buffer|undefined;
	let recoveryWrappingKey: Buffer|undefined;
	try {
		const vaultId = randomBytes(vaultIdentifierBytes).toString('base64url');
		const kdf: StoredPassphraseKdfParameters = {
			algorithm: 'argon2id',
			version: 19,
			salt: randomBytes(saltBytes).toString('base64url'),
			tagLength: 32,
			...options.passphraseKdf,
		};
		const passphraseEnvelope = {
			purpose: 'passphrase',
			generation: 1,
			kdf,
		} as const;
		const argon2idOutput = await derivePassphraseArgon2id(options.passphrase, kdf);
		try {
			wrappingKey = derivePassphraseWrappingKey(argon2idOutput, kdf);
		} finally {
			argon2idOutput.fill(0);
		}
		const recoverySecretBytes = randomBytes(recoverySecretLength);
		try {
			const recoverySecret = encodeRecoverySecret(recoverySecretBytes);
			const recoveryKdf: StoredRecoveryKdfParameters = {
				algorithm: 'hkdf-sha256',
				salt: randomBytes(saltBytes).toString('base64url'),
			};
			const recoveryEnvelope = {
				purpose: 'recovery',
				generation: 1,
				kdf: recoveryKdf,
			} as const;
			recoveryWrappingKey = deriveRecoveryWrappingKey(
				recoverySecretBytes,
				recoveryKdf,
			);
			return {
				recoverySecret,
				publicState: {
					format: 'watchtower-vault-key-envelope',
					version: 1,
					vaultId,
					activeGeneration: 1,
					passphrase: {
						...passphraseEnvelope,
						wrappedKey: wrapLocalVaultKey(
							localVaultKey,
							wrappingKey,
							envelopeAuthenticatedData(vaultId, passphraseEnvelope),
						),
					},
					recovery: {
						...recoveryEnvelope,
						wrappedKey: wrapLocalVaultKey(
							localVaultKey,
							recoveryWrappingKey,
							envelopeAuthenticatedData(vaultId, recoveryEnvelope),
						),
					},
				},
			};
		} finally {
			recoverySecretBytes.fill(0);
		}
	} finally {
		wrappingKey?.fill(0);
		recoveryWrappingKey?.fill(0);
		localVaultKey.fill(0);
	}
};

const unlockWithPassphrase = async (
	publicState: VaultKeyEnvelopePublicState,
	passphrase: string,
): Promise<VaultSessionKeyRing> => {
	try {
		publicState = validatePublicState(publicState);
		const argon2idOutput = await derivePassphraseArgon2id(
			passphrase,
			publicState.passphrase.kdf,
		);
		let wrappingKey: Buffer|undefined;
		try {
			wrappingKey = derivePassphraseWrappingKey(
				argon2idOutput,
				publicState.passphrase.kdf,
			);
			const { wrappedKey, ...envelope } = publicState.passphrase;
			return new VaultSessionKeyRingImpl(
				unwrapLocalVaultKey(
					wrappedKey,
					wrappingKey,
					envelopeAuthenticatedData(publicState.vaultId, envelope),
				),
				publicState.vaultId,
			);
		} finally {
			argon2idOutput.fill(0);
			wrappingKey?.fill(0);
		}
	} catch (error) {
		if (error instanceof InvalidVaultKeyEnvelopeError) throw error;
		throw new InvalidVaultKeyEnvelopeError();
	}
};

const unlockWithRecoverySecret = async (
	publicState: VaultKeyEnvelopePublicState,
	recoverySecretValue: string,
): Promise<VaultSessionKeyRing> => {
	try {
		publicState = validatePublicState(publicState);
		const recoverySecret = decodeRecoverySecret(recoverySecretValue);
		let wrappingKey: Buffer|undefined;
		try {
			wrappingKey = deriveRecoveryWrappingKey(
				recoverySecret,
				publicState.recovery.kdf,
			);
			const { wrappedKey, ...envelope } = publicState.recovery;
			return new VaultSessionKeyRingImpl(
				unwrapLocalVaultKey(
					wrappedKey,
					wrappingKey,
					envelopeAuthenticatedData(publicState.vaultId, envelope),
				),
				publicState.vaultId,
			);
		} finally {
			recoverySecret.fill(0);
			wrappingKey?.fill(0);
		}
	} catch (error) {
		if (error instanceof InvalidVaultKeyEnvelopeError) throw error;
		throw new InvalidVaultKeyEnvelopeError();
	}
};

const replacePassphrase = async (
	publicState: VaultKeyEnvelopePublicState,
	keyRing: VaultSessionKeyRing,
	passphrase: string,
	passphraseKdf: PassphraseKdfParameters,
) => {
	publicState = validatePublicState(publicState);
	if (!(keyRing instanceof VaultSessionKeyRingImpl)) {
		throw new InvalidVaultKeyEnvelopeError();
	}
	return keyRing.createPassphraseReplacement(
		publicState,
		passphrase,
		passphraseKdf,
	);
};

const replaceRecoverySecret = (
	publicState: VaultKeyEnvelopePublicState,
	keyRing: VaultSessionKeyRing,
) => {
	publicState = validatePublicState(publicState);
	if (!(keyRing instanceof VaultSessionKeyRingImpl)) {
		throw new InvalidVaultKeyEnvelopeError();
	}
	return keyRing.createRecoveryReplacement(publicState);
};

const VaultKeyEnvelope = {
	create,
	inspectPublicState,
	parsePublicState,
	replacePassphrase,
	replaceRecoverySecret,
	unlockWithPassphrase,
	unlockWithRecoverySecret,
};

export default VaultKeyEnvelope;
