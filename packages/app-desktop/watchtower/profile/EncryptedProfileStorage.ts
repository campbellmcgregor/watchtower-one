import {
	VaultOpenHandle,
	VaultSessionCapability,
} from '../vault/PreProfileVaultBootstrap';
import { createHash } from 'crypto';

export type ProfileSqlParameters = unknown[]|Record<string, unknown>|null;
export type ProfileSqlRow = Record<string, unknown>|undefined;

export interface EncryptedProfileConnection {
	selectOne(sql: string, params?: ProfileSqlParameters): Promise<ProfileSqlRow>;
	selectAll(sql: string, params?: ProfileSqlParameters): Promise<Record<string, unknown>[]>;
	exec(sql: string, params?: ProfileSqlParameters): Promise<unknown>;
	close(signal: AbortSignal): Promise<void>;
	terminate(): boolean;
}

export interface EncryptedProfileDatabase {
	open(options: { name: string }): Promise<void>;
	close(): Promise<void>;
	selectOne(sql: string, params?: ProfileSqlParameters): Promise<ProfileSqlRow>;
	selectAll(sql: string, params?: ProfileSqlParameters): Promise<Record<string, unknown>[]>;
	exec(sql: string, params?: ProfileSqlParameters): Promise<unknown>;
	sqliteErrorToJsError(error: unknown): Error;
}

export type ResourceContentKind = 'content'|'syncCiphertext';

export interface ResourceContentMetadata {
	fileName?: string;
	kind: ResourceContentKind;
	resourceId: string;
	size: number;
	updatedTime: number;
}

export interface ResourceContent {
	import(resourceId: string, content: Uint8Array, kind?: ResourceContentKind, fileName?: string): Promise<void>;
	list(): Promise<ResourceContentMetadata[]>;
	metadata(resourceId: string, kind?: ResourceContentKind): Promise<ResourceContentMetadata|undefined>;
	read(resourceId: string, kind?: ResourceContentKind): Promise<Buffer>;
	remove(resourceId: string, kind?: ResourceContentKind): Promise<void>;
	touch(resourceId: string, kind: ResourceContentKind, updatedTime: number): Promise<void>;
}

export type PrivateProfileScope = 'settings'|`plugin:${string}`;

export interface PrivateProfileData {
	write(scope: PrivateProfileScope, key: string, content: Uint8Array): Promise<void>;
	read(scope: PrivateProfileScope, key: string): Promise<Buffer|undefined>;
	remove(scope: PrivateProfileScope, key: string): Promise<void>;
}

export type EphemeralArtifactCategory = 'cache'|'log'|'electronState'|'temporary';

export interface EphemeralProfileArtifacts {
	write(category: EphemeralArtifactCategory, key: string, content: Uint8Array): Promise<void>;
	read(category: EphemeralArtifactCategory, key: string): Promise<Buffer|undefined>;
	remove(category: EphemeralArtifactCategory, key: string): Promise<void>;
}

export const encryptedProfileDatabaseName = 'watchtower-profile';
export const maximumResourceContentBytes = 100 * 1024 * 1024;

export default class EncryptedProfileStorage implements VaultOpenHandle {

	private readonly ephemeralArtifacts_ = new Map<string, Buffer>();

	public constructor(private readonly connection_: EncryptedProfileConnection) {}

	public database(capability: VaultSessionCapability): EncryptedProfileDatabase {
		let clientState: 'new'|'open'|'closed' = 'new';
		const withSession = async <T>(operation: ()=> Promise<T>): Promise<T> => {
			if (clientState !== 'open') throw new Error('Encrypted profile database is not open');
			const lease = capability();
			try {
				lease();
				return await operation();
			} finally {
				lease.release();
			}
		};

		return {
			open: async options => {
				if (clientState !== 'new') throw new Error('Encrypted profile database cannot be reopened');
				if (options.name !== encryptedProfileDatabaseName) {
					throw new Error('Encrypted profile database requires its logical profile identifier');
				}
				const lease = capability();
				try {
					lease();
					clientState = 'open';
				} finally {
					lease.release();
				}
			},
			close: async () => {
				clientState = 'closed';
			},
			selectOne: (sql, params) => withSession(
				() => this.connection_.selectOne(sql, params),
			),
			selectAll: (sql, params) => withSession(
				() => this.connection_.selectAll(sql, params),
			),
			exec: (sql, params) => withSession(
				() => this.connection_.exec(sql, params),
			),
			sqliteErrorToJsError: error => {
				const source = error instanceof Error ? error : new Error('Encrypted profile query failed');
				const output = new Error(source.message);
				const code = (source as Error & { code?: string }).code;
				if (code) (output as Error & { code?: string }).code = code;
				return output;
			},
		};
	}

	public resources(capability: VaultSessionCapability): ResourceContent {
		let initialization: Promise<void>|undefined;
		const validateResourceId = (resourceId: string) => {
			if (!/^[A-Za-z0-9]{32}$/.test(resourceId)) {
				throw new Error('Resource content identifier is invalid');
			}
		};
		const validateKind = (kind: ResourceContentKind) => {
			if (kind !== 'content' && kind !== 'syncCiphertext') {
				throw new Error('Resource content kind is invalid');
			}
		};
		const validateFileName = (fileName: string|undefined) => {
			if (
				fileName !== undefined &&
				(!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(fileName) || fileName.length > 255)
			) {
				throw new Error('Resource content file name is invalid');
			}
		};
		const metadataFromRow = (row: Record<string, unknown>): ResourceContentMetadata => {
			const resourceId = String(row.resource_id);
			const kind = row.content_kind as ResourceContentKind;
			const fileName = typeof row.file_name === 'string' ? row.file_name : undefined;
			const size = Number(row.size);
			const updatedTime = Number(row.updated_time);
			validateResourceId(resourceId);
			validateKind(kind);
			validateFileName(fileName);
			if (
				!Number.isSafeInteger(size) ||
				size < 0 ||
				size > maximumResourceContentBytes ||
				!Number.isSafeInteger(updatedTime) ||
				updatedTime < 0
			) {
				throw new Error('Resource content metadata failed its integrity check');
			}
			return { fileName, kind, resourceId, size, updatedTime };
		};
		const withSession = async <T>(operation: ()=> Promise<T>): Promise<T> => {
			const lease = capability();
			try {
				lease();
				return await operation();
			} finally {
				lease.release();
			}
		};
		const initialize = async () => {
			if (!initialization) {
				initialization = (async () => {
					await this.connection_.exec(`
						CREATE TABLE IF NOT EXISTS watchtower_resource_content (
							resource_id TEXT NOT NULL,
							content_kind TEXT NOT NULL,
							content TEXT NOT NULL,
							size INT NOT NULL,
							sha256 TEXT NOT NULL,
							file_name TEXT,
							updated_time INT NOT NULL,
							PRIMARY KEY (resource_id, content_kind)
						)
					`);
				})();
			}
			await initialization;
		};

		return {
			import: async (resourceId, input, kind = 'content', fileName) => withSession(async () => {
				validateResourceId(resourceId);
				validateKind(kind);
				validateFileName(fileName);
				if (input.byteLength > maximumResourceContentBytes) {
					throw new Error('Resource content exceeds the supported size');
				}
				await initialize();
				const content = Buffer.from(input);
				const digest = createHash('sha256').update(content).digest('hex');
				await this.connection_.exec(`
					INSERT INTO watchtower_resource_content
						(resource_id, content_kind, content, size, sha256, file_name, updated_time)
					VALUES (?, ?, ?, ?, ?, ?, ?)
					ON CONFLICT(resource_id, content_kind) DO UPDATE SET
						content = excluded.content,
						size = excluded.size,
						sha256 = excluded.sha256,
						file_name = excluded.file_name,
						updated_time = excluded.updated_time
				`, [resourceId, kind, content, content.byteLength, digest, fileName ?? null, Date.now()]);
			}),
			list: async () => withSession(async () => {
				await initialize();
				const rows = await this.connection_.selectAll(`
					SELECT resource_id, content_kind, size, file_name, updated_time
					FROM watchtower_resource_content
					ORDER BY resource_id, content_kind
				`);
				return rows.map(metadataFromRow);
			}),
			metadata: async (resourceId, kind = 'content') => withSession(async () => {
				validateResourceId(resourceId);
				validateKind(kind);
				await initialize();
				const row = await this.connection_.selectOne(`
					SELECT resource_id, content_kind, size, file_name, updated_time
					FROM watchtower_resource_content
					WHERE resource_id = ? AND content_kind = ?
				`, [resourceId, kind]);
				return row ? metadataFromRow(row) : undefined;
			}),
			read: async (resourceId, kind = 'content') => withSession(async () => {
				validateResourceId(resourceId);
				validateKind(kind);
				await initialize();
				const row = await this.connection_.selectOne(`
					SELECT content, size, sha256, typeof(content) AS storage_class
					FROM watchtower_resource_content
					WHERE resource_id = ? AND content_kind = ?
				`, [resourceId, kind]);
				if (
					!row ||
					row.storage_class !== 'blob' ||
					!ArrayBuffer.isView(row.content)
				) {
					throw new Error('Resource content is unavailable');
				}
				const content = Buffer.from(row.content as Uint8Array);
				const digest = createHash('sha256').update(content).digest('hex');
				if (Number(row.size) !== content.byteLength || row.sha256 !== digest) {
					throw new Error('Resource content failed its integrity check');
				}
				return content;
			}),
			remove: async (resourceId, kind = 'content') => withSession(async () => {
				validateResourceId(resourceId);
				validateKind(kind);
				await initialize();
				await this.connection_.exec(
					'DELETE FROM watchtower_resource_content WHERE resource_id = ? AND content_kind = ?',
					[resourceId, kind],
				);
			}),
			touch: async (resourceId, kind, updatedTime) => withSession(async () => {
				validateResourceId(resourceId);
				validateKind(kind);
				if (!Number.isSafeInteger(updatedTime) || updatedTime < 0) {
					throw new Error('Resource content timestamp is invalid');
				}
				await initialize();
				await this.connection_.exec(
					'UPDATE watchtower_resource_content SET updated_time = ? WHERE resource_id = ? AND content_kind = ?',
					[updatedTime, resourceId, kind],
				);
			}),
		};
	}

	public privateData(capability: VaultSessionCapability): PrivateProfileData {
		let initialization: Promise<void>|undefined;
		const validateAddress = (scope: PrivateProfileScope, key: string) => {
			if (
				(scope !== 'settings' && !/^plugin:[A-Za-z0-9._-]+$/.test(scope)) ||
				!/^[A-Za-z0-9._:-]+$/.test(key)
			) {
				throw new Error('Private profile data address is invalid');
			}
		};
		const withSession = async <T>(operation: ()=> Promise<T>): Promise<T> => {
			const lease = capability();
			try {
				lease();
				return await operation();
			} finally {
				lease.release();
			}
		};
		const initialize = async () => {
			if (!initialization) {
				initialization = (async () => {
					await this.connection_.exec(`
						CREATE TABLE IF NOT EXISTS watchtower_private_profile_data (
							scope TEXT NOT NULL,
							data_key TEXT NOT NULL,
							content TEXT NOT NULL,
							size INT NOT NULL,
							sha256 TEXT NOT NULL,
							PRIMARY KEY (scope, data_key)
						)
					`);
				})();
			}
			await initialization;
		};

		return {
			write: async (scope, key, input) => withSession(async () => {
				validateAddress(scope, key);
				await initialize();
				const content = Buffer.from(input);
				const digest = createHash('sha256').update(content).digest('hex');
				await this.connection_.exec(`
					INSERT INTO watchtower_private_profile_data
						(scope, data_key, content, size, sha256)
					VALUES (?, ?, ?, ?, ?)
					ON CONFLICT(scope, data_key) DO UPDATE SET
						content = excluded.content,
						size = excluded.size,
						sha256 = excluded.sha256
				`, [scope, key, content, content.byteLength, digest]);
			}),
			read: async (scope, key) => withSession(async () => {
				validateAddress(scope, key);
				await initialize();
				const row = await this.connection_.selectOne(`
					SELECT content, size, sha256, typeof(content) AS storage_class
					FROM watchtower_private_profile_data
					WHERE scope = ? AND data_key = ?
				`, [scope, key]);
				if (!row) return undefined;
				if (row.storage_class !== 'blob' || !ArrayBuffer.isView(row.content)) {
					throw new Error('Private profile data is unavailable');
				}
				const content = Buffer.from(row.content as Uint8Array);
				const digest = createHash('sha256').update(content).digest('hex');
				if (Number(row.size) !== content.byteLength || row.sha256 !== digest) {
					throw new Error('Private profile data failed its integrity check');
				}
				return content;
			}),
			remove: async (scope, key) => withSession(async () => {
				validateAddress(scope, key);
				await initialize();
				await this.connection_.exec(
					'DELETE FROM watchtower_private_profile_data WHERE scope = ? AND data_key = ?',
					[scope, key],
				);
			}),
		};
	}

	public ephemeral(capability: VaultSessionCapability): EphemeralProfileArtifacts {
		const address = (category: EphemeralArtifactCategory, key: string) => {
			if (
				!['cache', 'log', 'electronState', 'temporary'].includes(category) ||
				!/^[A-Za-z0-9._:-]+$/.test(key)
			) {
				throw new Error('Ephemeral profile artifact address is invalid');
			}
			return `${category}:${key}`;
		};
		const withSession = async <T>(operation: ()=> T|Promise<T>): Promise<T> => {
			const lease = capability();
			try {
				lease();
				return await operation();
			} finally {
				lease.release();
			}
		};

		return {
			write: (category, key, content) => withSession(() => {
				this.ephemeralArtifacts_.set(address(category, key), Buffer.from(content));
			}),
			read: (category, key) => withSession(() => {
				const content = this.ephemeralArtifacts_.get(address(category, key));
				return content ? Buffer.from(content) : undefined;
			}),
			remove: (category, key) => withSession(() => {
				this.ephemeralArtifacts_.delete(address(category, key));
			}),
		};
	}

	public async close(signal: AbortSignal): Promise<void> {
		this.ephemeralArtifacts_.clear();
		await this.connection_.close(signal);
	}

	public terminate(): boolean {
		this.ephemeralArtifacts_.clear();
		return this.connection_.terminate();
	}
}
