import {
	EncryptedProfileConnection,
	ProfileSqlParameters,
	ProfileSqlRow,
} from './profileStorageTypes';
import {
	SqlCipherNativeDatabase,
	SqlCipherNativeStatement,
	SqlCipherProfileConfigurationError,
	UnsafeProfileQueryError,
} from './sqlCipherProfileTypes';
// cspell:ignore hexkey

const requiredCompileOptions = [
	'DQS=3',
	'ENABLE_FTS3',
	'ENABLE_FTS4',
	'ENABLE_FTS5',
];

const simplePragma = (database: SqlCipherNativeDatabase, source: string) => {
	return database.pragma(source, { simple: true });
};

export default class SqlCipherEncryptedProfileConnection implements EncryptedProfileConnection {

	private closed_ = false;

	private constructor(private readonly database_: SqlCipherNativeDatabase) {}

	public static async verify(
		database: SqlCipherNativeDatabase,
	): Promise<SqlCipherEncryptedProfileConnection> {
		try {
			const compileStatement = database.prepare('PRAGMA compile_options');
			let compileRows: Record<string, unknown>[];
			try {
				compileRows = await Promise.resolve(compileStatement.all());
			} finally {
				compileStatement.close?.();
			}
			const compileOptions = compileRows.map(row => String(Object.values(row)[0]));
			if (
				requiredCompileOptions.some(option => !compileOptions.includes(option)) ||
				!compileOptions.some(option => option === 'TEMP_STORE=2' || option === 'TEMP_STORE=3')
			) {
				throw new SqlCipherProfileConfigurationError('incompatibleSqlCipherBuild');
			}

			const cipherVersion = String(simplePragma(database, 'cipher_version') ?? '');
			if (!cipherVersion) {
				throw new SqlCipherProfileConfigurationError('incompatibleSqlCipherBuild');
			}

			database.pragma('cipher_plaintext_header_size = 0');
			database.pragma('cipher_log_level = ERROR');
			database.pragma('cipher_memory_security = ON');
			database.pragma('temp_store = MEMORY');
			database.pragma('secure_delete = ON');
			database.pragma('foreign_keys = ON');
			database.pragma('journal_mode = WAL');

			const settingsAreSafe =
				Number(simplePragma(database, 'cipher_plaintext_header_size')) === 0 &&
				Number(simplePragma(database, 'cipher_memory_security')) === 1 &&
				Number(simplePragma(database, 'temp_store')) === 2 &&
				Number(simplePragma(database, 'secure_delete')) === 1 &&
				Number(simplePragma(database, 'foreign_keys')) === 1 &&
				String(simplePragma(database, 'journal_mode')).toLowerCase() === 'wal';
			if (!settingsAreSafe) {
				throw new SqlCipherProfileConfigurationError('unsafeSqlCipherConfiguration');
			}

			if (String(simplePragma(database, 'integrity_check')).toLowerCase() !== 'ok') {
				throw new SqlCipherProfileConfigurationError('invalidEncryptedProfile');
			}
			const cipherIntegrity = database.pragma('cipher_integrity_check');
			if (!Array.isArray(cipherIntegrity) || cipherIntegrity.length) {
				throw new SqlCipherProfileConfigurationError('invalidEncryptedProfile');
			}

			return new SqlCipherEncryptedProfileConnection(database);
		} catch (error) {
			try {
				database.close();
			} catch {
				// The caller receives only the typed configuration outcome.
			}
			if (error instanceof SqlCipherProfileConfigurationError) throw error;
			throw new SqlCipherProfileConfigurationError('invalidEncryptedProfile');
		}
	}

	private requireOpen_() {
		if (this.closed_) throw new Error('Encrypted profile database is closed');
	}

	private assertSafeSql_(sql: string) {
		const normalized = sql
			.replace(/\/\*[\s\S]*?\*\//g, ' ')
			.replace(/--[^\r\n]*/g, ' ')
			.replace(/\s+/g, ' ')
			.trim()
			.toLowerCase()
			.replace(/(['"`[])([a-z_][a-z0-9_]*)(?:['"`\]])/g, '$2');

		if (
			/\battach\b/.test(normalized) ||
			/\bload_extension\s*\(/.test(normalized) ||
			/\bvacuum\s+into\b/.test(normalized) ||
			/\bpragma\s+(?:(?:main|temp)\s*\.\s*)?(?:key|hexkey|rekey|cipher_[a-z0-9_]+)\s*(?:=|\()/.test(normalized)
		) {
			throw new UnsafeProfileQueryError();
		}

		const protectedPragmaPattern = new RegExp(
			[
				'\\bpragma\\s+',
				'(?:(?:main|temp)\\s*\\.\\s*)?',
				'(temp_store|temp_store_directory|data_store_directory|',
				'journal_mode|secure_delete|foreign_keys)',
				'\\s*(?:=\\s*([^;]+)|\\(\\s*([^)]*)\\s*\\))',
			].join(''),
			'g',
		);
		for (const match of normalized.matchAll(protectedPragmaPattern)) {
			const [, name, assignmentValue, functionValue] = match;
			const value = (assignmentValue ?? functionValue)
				.trim()
				.replace(/^(['"])(.*)\1$/, '$2');
			const permitted = (
				(name === 'temp_store' && (value === 'memory' || value === '2')) ||
				(name === 'journal_mode' && value === 'wal') ||
				(name === 'secure_delete' && (value === 'on' || value === '1')) ||
				(name === 'foreign_keys' && (value === 'on' || value === '1'))
			);
			if (!permitted) throw new UnsafeProfileQueryError();
		}
	}

	private async useStatement_<T>(
		sql: string,
		operation: (statement: SqlCipherNativeStatement)=> T|Promise<T>,
	): Promise<T> {
		this.requireOpen_();
		this.assertSafeSql_(sql);
		const statement = this.database_.prepare(sql);
		try {
			return await operation(statement);
		} finally {
			statement.close?.();
		}
	}

	public selectOne(sql: string, params?: ProfileSqlParameters): Promise<ProfileSqlRow> {
		return this.useStatement_(sql, statement => statement.get(params ?? []));
	}

	public selectAll(
		sql: string,
		params?: ProfileSqlParameters,
	): Promise<Record<string, unknown>[]> {
		return this.useStatement_(sql, statement => statement.all(params ?? []));
	}

	public exec(sql: string, params?: ProfileSqlParameters): Promise<unknown> {
		return this.useStatement_(sql, statement => statement.run(params ?? []));
	}

	public async close(_signal: AbortSignal): Promise<void> {
		if (this.closed_) return;
		this.database_.close();
		this.closed_ = true;
	}

	public terminate(): boolean {
		if (this.closed_) return true;
		try {
			this.database_.close();
			this.closed_ = true;
			return true;
		} catch {
			return false;
		}
	}
}
