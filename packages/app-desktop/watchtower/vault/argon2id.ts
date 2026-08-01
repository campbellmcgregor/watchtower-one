import {
	Algorithm,
	hashRaw,
	Version,
} from '@node-rs/argon2';

export interface Argon2idParameters {
	message: Buffer;
	salt: Buffer;
	parallelism: number;
	tagLengthBytes: number;
	memoryKiB: number;
	passes: number;
}

const deriveArgon2id = async (
	parameters: Argon2idParameters,
): Promise<Buffer> => {
	return await hashRaw(parameters.message, {
		algorithm: Algorithm.Argon2id,
		version: Version.V0x13,
		salt: parameters.salt,
		parallelism: parameters.parallelism,
		outputLen: parameters.tagLengthBytes,
		memoryCost: parameters.memoryKiB,
		timeCost: parameters.passes,
	});
};

export default deriveArgon2id;
