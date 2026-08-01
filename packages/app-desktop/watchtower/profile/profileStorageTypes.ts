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
	list(scope: PrivateProfileScope): Promise<string[]>;
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
export const maximumSyncCiphertextBytes =
	Math.ceil(maximumResourceContentBytes * 4 / 3) + 2 * 1024 * 1024;
