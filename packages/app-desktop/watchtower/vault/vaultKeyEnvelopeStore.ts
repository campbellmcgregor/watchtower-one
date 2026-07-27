import { constants } from 'fs';
import {
	access,
	mkdir,
	open,
	realpath,
	rename,
	rm,
} from 'fs/promises';
import { join } from 'path';
import VaultKeyEnvelope, {
	maximumVaultKeyEnvelopePublicStateBytes,
	VaultKeyEnvelopePublicState,
} from './vaultKeyEnvelope';

const committedEnvelopeFileName = 'vault-key-envelope.json';
const pendingEnvelopeFileName = 'vault-key-envelope.pending';

class SerializedCommitQueue {

	private active_ = false;
	private readonly waiters_: (()=> void)[] = [];

	public idle() {
		return !this.active_;
	}

	public async run(operation: ()=> Promise<void>) {
		await this.acquire_();
		try {
			await operation();
		} finally {
			this.release_();
		}
	}

	private async acquire_() {
		if (!this.active_) {
			this.active_ = true;
			return;
		}
		await new Promise<void>(resolve => {
			this.waiters_.push(resolve);
		});
	}

	private release_() {
		const next = this.waiters_.shift();
		if (next) {
			next();
		} else {
			this.active_ = false;
		}
	}
}

const commitQueues = new Map<string, SerializedCommitQueue>();

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

export type CommittedVaultKeyEnvelopeInspection =
	{ kind: 'missing' }|
	{ kind: 'committed'; publicState: VaultKeyEnvelopePublicState };

export type VaultKeyEnvelopeDurabilityPhase =
	'pending-synced'|'committed-synced';

export interface VaultKeyEnvelopeDurabilityObserver {
	reached(phase: VaultKeyEnvelopeDurabilityPhase): Promise<void>;
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

const readBoundedFile = async (path: string) => {
	const handle = await open(path, 'r');
	try {
		const metadata = await handle.stat();
		if (!metadata.isFile()) throw new InvalidCommittedVaultKeyEnvelopeError();
		const buffer = Buffer.alloc(
			maximumVaultKeyEnvelopePublicStateBytes + 1,
		);
		let bytesRead = 0;
		while (bytesRead < buffer.byteLength) {
			const readResult = await handle.read(
				buffer,
				bytesRead,
				buffer.byteLength - bytesRead,
				bytesRead,
			);
			if (readResult.bytesRead === 0) break;
			bytesRead += readResult.bytesRead;
		}
		if (bytesRead > maximumVaultKeyEnvelopePublicStateBytes) {
			throw new InvalidCommittedVaultKeyEnvelopeError();
		}
		return buffer.toString('utf8', 0, bytesRead);
	} finally {
		await handle.close();
	}
};

export default class VaultKeyEnvelopeStore {
	private durabilityObserver_: VaultKeyEnvelopeDurabilityObserver|null = null;

	public constructor(private readonly directoryPath_: string) {}

	public static withDurabilityObserver(
		directoryPath: string,
		observer: VaultKeyEnvelopeDurabilityObserver,
	) {
		const store = new VaultKeyEnvelopeStore(directoryPath);
		store.durabilityObserver_ = observer;
		return store;
	}

	public async commit(publicState: VaultKeyEnvelopePublicState): Promise<void> {
		let queueKey: string;
		try {
			await mkdir(this.directoryPath_, { recursive: true, mode: 0o700 });
			const canonicalPath = await realpath(this.directoryPath_);
			queueKey = process.platform === 'win32' ?
				canonicalPath.toLocaleLowerCase('en-US') :
				canonicalPath;
		} catch (error) {
			throw new VaultKeyEnvelopeCommitError();
		}

		let queue = commitQueues.get(queueKey);
		if (!queue) {
			queue = new SerializedCommitQueue();
			commitQueues.set(queueKey, queue);
		}
		try {
			await queue.run(async () => {
				await this.commitExclusive_(publicState);
			});
		} finally {
			if (
				queue.idle() &&
				commitQueues.get(queueKey) === queue
			) {
				commitQueues.delete(queueKey);
			}
		}
	}

	private async commitExclusive_(
		publicState: VaultKeyEnvelopePublicState,
	): Promise<void> {
		try {
			const serialized = JSON.stringify(publicState);
			const validatedState = VaultKeyEnvelope.parsePublicState(serialized);
			const validatedSerialized = JSON.stringify(validatedState);
			if (
				Buffer.byteLength(validatedSerialized, 'utf8') >
				maximumVaultKeyEnvelopePublicStateBytes
			) {
				throw new InvalidCommittedVaultKeyEnvelopeError();
			}

			const pendingPath = join(this.directoryPath_, pendingEnvelopeFileName);
			const committedPath = join(
				this.directoryPath_,
				committedEnvelopeFileName,
			);
			if (await pathExists(committedPath)) {
				const committedState = await this.loadCommitted();
				if (
					committedState.vaultId !== validatedState.vaultId ||
					validatedState.activeGeneration <=
						committedState.activeGeneration
				) {
					throw new VaultKeyEnvelopeCommitError();
				}
			}

			let pendingHandle;
			try {
				pendingHandle = await open(pendingPath, 'w', 0o600);
				await pendingHandle.writeFile(validatedSerialized, 'utf8');
				await pendingHandle.sync();
				await this.durabilityObserver_?.reached('pending-synced');
				await pendingHandle.close();
				pendingHandle = undefined;
				await rename(pendingPath, committedPath);
				await syncDirectoryWhereSupported(this.directoryPath_);
				await this.durabilityObserver_?.reached('committed-synced');
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
		const inspection = await this.inspectCommitted();
		if (inspection.kind === 'missing') {
			throw new InvalidCommittedVaultKeyEnvelopeError();
		}
		return inspection.publicState;
	}

	public async inspectCommitted(): Promise<CommittedVaultKeyEnvelopeInspection> {
		const committedPath = join(this.directoryPath_, committedEnvelopeFileName);
		try {
			await access(committedPath, constants.R_OK);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return { kind: 'missing' };
			}
			throw new InvalidCommittedVaultKeyEnvelopeError();
		}
		try {
			return {
				kind: 'committed',
				publicState: VaultKeyEnvelope.parsePublicState(
					await readBoundedFile(committedPath),
				),
			};
		} catch (error) {
			if (error instanceof InvalidCommittedVaultKeyEnvelopeError) throw error;
			throw new InvalidCommittedVaultKeyEnvelopeError();
		}
	}
}
