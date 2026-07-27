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
	callback: (error: Error|null, derivedKey: Buffer|undefined)=> void,
)=> void;

interface NodeCryptoWithArgon2 {
	argon2: NodeArgon2;
}

const { argon2 } = require('crypto') as NodeCryptoWithArgon2;

export interface Argon2idParameters {
	message: Buffer;
	salt: Buffer;
	parallelism: number;
	tagLengthBytes: number;
	memoryKiB: number;
	passes: number;
}

const deriveArgon2id = (
	parameters: Argon2idParameters,
): Promise<Buffer> => {
	return new Promise((resolve, reject) => {
		const finish = (
			error: Error|null,
			derivedKey: Buffer|undefined,
		) => {
			if (error) {
				derivedKey?.fill(0);
				reject(error);
			} else {
				resolve(derivedKey!);
			}
		};
		try {
			argon2('argon2id', {
				message: parameters.message,
				nonce: parameters.salt,
				parallelism: parameters.parallelism,
				tagLength: parameters.tagLengthBytes,
				memory: parameters.memoryKiB,
				passes: parameters.passes,
			}, finish);
		} catch (error) {
			finish(error as Error, undefined);
		}
	});
};

export default deriveArgon2id;
