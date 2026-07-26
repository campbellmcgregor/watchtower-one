import { constants } from 'fs';
import {
	access,
	mkdir,
	open,
	readFile,
	rename,
	rm,
	stat,
} from 'fs/promises';
import { join } from 'path';
import VaultKeyEnvelope, {
	VaultKeyEnvelopePublicState,
} from './vaultKeyEnvelope';

const maximumCommittedEnvelopeBytes = 64 * 1024;
const committedEnvelopeFileName = 'vault-key-envelope.json';
const pendingEnvelopeFileName = 'vault-key-envelope.pending';

export class InvalidCommittedVaultKeyEnvelopeError extends Error {

	public constructor() {
		super('Committed Vault Key Envelope is missing or invalid');
		this.name = 'InvalidCommittedVaultKeyEnvelopeError';
	}
}

export class VaultKeyEnvelopeCommitError extends Error {

	public constructor() {
		super('Vault Key Envelope commit failed closed');
		this.name = 'VaultKeyEnvelopeCommitError';
	}
}

const syncDirectoryWhereSupported = async (directoryPath: string) => {
	let directoryHandle;
	try {
		directoryHandle = await open(directoryPath, 'r');
		await directoryHandle.sync();
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (!['EACCES', 'EBADF', 'EISDIR', 'EPERM'].includes(code ?? '')) {
			throw error;
		}
	} finally {
		await directoryHandle?.close();
	}
};

const pathExists = async (path: string) => {
	try {
		await access(path, constants.F_OK);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
		throw error;
	}
};

export default class VaultKeyEnvelopeStore {

	public constructor(private readonly directoryPath_: string) {}

	public async commit(publicState: VaultKeyEnvelopePublicState): Promise<void> {
		try {
			const serialized = JSON.stringify(publicState);
			const validatedState = VaultKeyEnvelope.parsePublicState(serialized);
			const validatedSerialized = JSON.stringify(validatedState);
			if (
				Buffer.byteLength(validatedSerialized, 'utf8') >
				maximumCommittedEnvelopeBytes
			) {
				throw new InvalidCommittedVaultKeyEnvelopeError();
			}

			await mkdir(this.directoryPath_, { recursive: true, mode: 0o700 });
			const pendingPath = join(this.directoryPath_, pendingEnvelopeFileName);
			const committedPath = join(
				this.directoryPath_,
				committedEnvelopeFileName,
			);
			if (await pathExists(committedPath)) {
				const committedState = await this.loadCommitted();
				if (committedState.vaultId !== validatedState.vaultId) {
					throw new VaultKeyEnvelopeCommitError();
				}
			}

			let pendingHandle;
			try {
				pendingHandle = await open(pendingPath, 'w', 0o600);
				await pendingHandle.writeFile(validatedSerialized, 'utf8');
				await pendingHandle.sync();
				await pendingHandle.close();
				pendingHandle = undefined;
				await rename(pendingPath, committedPath);
				await syncDirectoryWhereSupported(this.directoryPath_);
			} finally {
				await pendingHandle?.close();
				await rm(pendingPath, { force: true });
			}
		} catch (error) {
			if (error instanceof VaultKeyEnvelopeCommitError) throw error;
			throw new VaultKeyEnvelopeCommitError();
		}
	}

	public async loadCommitted(): Promise<VaultKeyEnvelopePublicState> {
		const committedPath = join(this.directoryPath_, committedEnvelopeFileName);
		try {
			await access(committedPath, constants.R_OK);
			const metadata = await stat(committedPath);
			if (
				!metadata.isFile() ||
				metadata.size > maximumCommittedEnvelopeBytes
			) {
				throw new InvalidCommittedVaultKeyEnvelopeError();
			}
			return VaultKeyEnvelope.parsePublicState(
				await readFile(committedPath, 'utf8'),
			);
		} catch (error) {
			if (error instanceof InvalidCommittedVaultKeyEnvelopeError) throw error;
			throw new InvalidCommittedVaultKeyEnvelopeError();
		}
	}
}
