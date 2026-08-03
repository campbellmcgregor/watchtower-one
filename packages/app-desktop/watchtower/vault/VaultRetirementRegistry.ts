import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { constants } from 'fs';
import {
	access,
	mkdir,
	open,
	rename,
	rm,
} from 'fs/promises';
import { join, parse, resolve } from 'path';
import type { VaultSessionKeyRing } from './vaultKeyEnvelope';

const authenticationTagBytes = 16;
const nonceBytes = 12;
const maximumMarkerBytes = 4 * 1024;
const retirementDirectoryName = 'retired-vaults';
const vaultDirectoryName = 'vault';
const vaultIdPattern = /^[A-Za-z0-9_-]{22}$/;

interface SerializedVaultRetirementMarker {
	format: 'watchtower-vault-retirement';
	version: 1;
	vaultId: string;
	algorithm: 'aes-256-gcm';
	nonce: string;
	ciphertext: string;
	authenticationTag: string;
}

export class VaultRetiredError extends Error {

	public constructor() {
		super('Vault has been retired');
		this.name = 'VaultRetiredError';
	}
}

export class VaultRetirementError extends Error {

	public constructor() {
		super('Vault retirement failed closed');
		this.name = 'VaultRetirementError';
	}
}

export interface VaultRetirementPolicy {
	assertActive(vaultId: string): Promise<void>;
	retire(
		vaultId: string,
		keyRing: VaultSessionKeyRing,
	): Promise<{ kind: 'retired' }>;
}

export type VaultRetirementDurabilityPhase =
	'marker-pending-synced'|'marker-committed-synced'|'vault-removed';

export interface VaultRetirementDurabilityObserver {
	reached(phase: VaultRetirementDurabilityPhase): Promise<void>;
}

const markerAuthenticatedData = (vaultId: string) => Buffer.from(
	`watchtower-one/v1/vault-retirement/${vaultId}`,
	'utf8',
);

const retirementPlaintext = (vaultId: string) => Buffer.from(JSON.stringify({
	format: 'watchtower-vault-retirement-record',
	version: 1,
	vaultId,
	status: 'retired',
}), 'utf8');

const validateVaultId = (vaultId: string) => {
	if (!vaultIdPattern.test(vaultId)) throw new VaultRetirementError();
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

const encryptMarker = (
	vaultId: string,
	key: Buffer,
): SerializedVaultRetirementMarker => {
	const nonce = randomBytes(nonceBytes);
	const plaintext = retirementPlaintext(vaultId);
	try {
		const cipher = createCipheriv('aes-256-gcm', key, nonce, {
			authTagLength: authenticationTagBytes,
		});
		cipher.setAAD(markerAuthenticatedData(vaultId));
		const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
		try {
			return {
				format: 'watchtower-vault-retirement',
				version: 1,
				vaultId,
				algorithm: 'aes-256-gcm',
				nonce: nonce.toString('base64url'),
				ciphertext: ciphertext.toString('base64url'),
				authenticationTag: cipher.getAuthTag().toString('base64url'),
			};
		} finally {
			ciphertext.fill(0);
		}
	} finally {
		plaintext.fill(0);
		nonce.fill(0);
	}
};

const verifyMarker = (
	marker: SerializedVaultRetirementMarker,
	key: Buffer,
) => {
	let plaintext: Buffer|undefined;
	try {
		const decipher = createDecipheriv(
			'aes-256-gcm',
			key,
			Buffer.from(marker.nonce, 'base64url'),
			{ authTagLength: authenticationTagBytes },
		);
		decipher.setAAD(markerAuthenticatedData(marker.vaultId));
		decipher.setAuthTag(Buffer.from(marker.authenticationTag, 'base64url'));
		plaintext = Buffer.concat([
			decipher.update(Buffer.from(marker.ciphertext, 'base64url')),
			decipher.final(),
		]);
		if (!plaintext.equals(retirementPlaintext(marker.vaultId))) {
			throw new VaultRetirementError();
		}
	} catch (error) {
		if (error instanceof VaultRetirementError) throw error;
		throw new VaultRetirementError();
	} finally {
		plaintext?.fill(0);
	}
};

const parseMarker = (serialized: string): SerializedVaultRetirementMarker => {
	try {
		if (Buffer.byteLength(serialized, 'utf8') > maximumMarkerBytes) {
			throw new VaultRetirementError();
		}
		const marker = JSON.parse(serialized) as Record<string, unknown>;
		if (
			Object.keys(marker).sort().join(',') !==
			'algorithm,authenticationTag,ciphertext,format,nonce,vaultId,version' ||
			marker.format !== 'watchtower-vault-retirement' ||
			marker.version !== 1 ||
			marker.algorithm !== 'aes-256-gcm' ||
			typeof marker.vaultId !== 'string' ||
			typeof marker.nonce !== 'string' ||
			typeof marker.ciphertext !== 'string' ||
			typeof marker.authenticationTag !== 'string'
		) throw new VaultRetirementError();
		validateVaultId(marker.vaultId);
		if (
			Buffer.from(marker.nonce, 'base64url').byteLength !== nonceBytes ||
			Buffer.from(marker.authenticationTag, 'base64url').byteLength !==
				authenticationTagBytes
		) throw new VaultRetirementError();
		return marker as unknown as SerializedVaultRetirementMarker;
	} catch (error) {
		if (error instanceof VaultRetirementError) throw error;
		throw new VaultRetirementError();
	}
};

export default class VaultRetirementRegistry implements VaultRetirementPolicy {
	private durabilityObserver_: VaultRetirementDurabilityObserver|null = null;
	private readonly userDataDirectory_: string;
	private readonly vaultDirectory_: string;
	private readonly retirementDirectory_: string;

	public constructor(userDataDirectory: string) {
		this.userDataDirectory_ = resolve(userDataDirectory);
		if (this.userDataDirectory_ === parse(this.userDataDirectory_).root) {
			throw new VaultRetirementError();
		}
		this.vaultDirectory_ = join(this.userDataDirectory_, vaultDirectoryName);
		this.retirementDirectory_ = join(
			this.userDataDirectory_,
			retirementDirectoryName,
		);
	}

	public static withDurabilityObserver(
		userDataDirectory: string,
		observer: VaultRetirementDurabilityObserver,
	) {
		const registry = new VaultRetirementRegistry(userDataDirectory);
		registry.durabilityObserver_ = observer;
		return registry;
	}

	private markerPath_(vaultId: string) {
		validateVaultId(vaultId);
		return join(this.retirementDirectory_, `${vaultId}.json`);
	}

	public async assertActive(vaultId: string): Promise<void> {
		try {
			if (!await pathExists(this.markerPath_(vaultId))) return;
			await rm(this.vaultDirectory_, { recursive: true, force: true });
			throw new VaultRetiredError();
		} catch (error) {
			if (error instanceof VaultRetiredError) throw error;
			throw new VaultRetirementError();
		}
	}

	public async retire(
		vaultId: string,
		keyRing: VaultSessionKeyRing,
	): Promise<{ kind: 'retired' }> {
		const markerPath = this.markerPath_(vaultId);
		const pendingPath = `${markerPath}.pending`;
		try {
			await mkdir(this.retirementDirectory_, { recursive: true, mode: 0o700 });
			await syncDirectoryWhereSupported(this.userDataDirectory_);
			if (!await pathExists(markerPath)) {
				await keyRing.withDerivedKey(
					'vault-metadata-authentication',
					async key => {
						const marker = encryptMarker(vaultId, key);
						const serialized = JSON.stringify(marker);
						let pendingHandle;
						try {
							pendingHandle = await open(pendingPath, 'w', 0o600);
							await pendingHandle.writeFile(serialized, 'utf8');
							await pendingHandle.sync();
							await this.durabilityObserver_?.reached('marker-pending-synced');
							await pendingHandle.close();
							pendingHandle = undefined;
							const reopened = parseMarker(
								await readMarker(pendingPath),
							);
							if (reopened.vaultId !== vaultId) {
								throw new VaultRetirementError();
							}
							verifyMarker(reopened, key);
							await rename(pendingPath, markerPath);
							await syncDirectoryWhereSupported(this.retirementDirectory_);
							await this.durabilityObserver_?.reached('marker-committed-synced');
						} finally {
							await pendingHandle?.close();
						}
					},
				);
			}
			await rm(this.vaultDirectory_, { recursive: true, force: true });
			await this.durabilityObserver_?.reached('vault-removed');
			return { kind: 'retired' };
		} catch (error) {
			throw new VaultRetirementError();
		} finally {
			await rm(pendingPath, { force: true });
		}
	}
}

const readMarker = async (path: string) => {
	const handle = await open(path, 'r');
	try {
		const buffer = Buffer.alloc(maximumMarkerBytes + 1);
		const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
		if (bytesRead > maximumMarkerBytes) throw new VaultRetirementError();
		return buffer.toString('utf8', 0, bytesRead);
	} finally {
		await handle.close();
	}
};
