import {
	ProfileSqlParameters,
	ProfileSqlRow,
} from './profileStorageTypes';

export interface SqlCipherNativeStatement {
	run(params?: ProfileSqlParameters): unknown|Promise<unknown>;
	get(params?: ProfileSqlParameters): ProfileSqlRow|Promise<ProfileSqlRow>;
	all(params?: ProfileSqlParameters): Record<string, unknown>[]|Promise<Record<string, unknown>[]>;
	close?(): void;
}

export interface SqlCipherNativeDatabase {
	pragma(source: string, options?: { simple?: true }): unknown;
	prepare(sql: string): SqlCipherNativeStatement;
	close(): void;
}

export type SqlCipherProfileConfigurationErrorCode =
	'incompatibleSqlCipherBuild'|
	'invalidEncryptedProfile'|
	'unsafeSqlCipherConfiguration';

export class SqlCipherProfileConfigurationError extends Error {
	public constructor(public readonly code: SqlCipherProfileConfigurationErrorCode) {
		super(`Encrypted profile database rejected: ${code}`);
		this.name = 'SqlCipherProfileConfigurationError';
	}
}

export class UnsafeProfileQueryError extends Error {
	public readonly code = 'unsafeProfileQuery';

	public constructor() {
		super('Encrypted profile query rejected by persistence policy');
		this.name = 'UnsafeProfileQueryError';
	}
}
