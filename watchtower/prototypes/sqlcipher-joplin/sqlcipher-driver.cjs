const path = require('node:path');
const { createRequire } = require('node:module');

if (process.env.WATCHTOWER_SQLCIPHER_PREBUILD_ROOT) {
	process.env['@SIGNALAPP/SQLCIPHER_PREBUILD'] = path.resolve(process.env.WATCHTOWER_SQLCIPHER_PREBUILD_ROOT);
}

const desktopRequire = createRequire(path.resolve(__dirname, '../../../packages/app-desktop/package.json'));
const { default: SqlCipherDatabase, setLogger } = desktopRequire('@signalapp/sqlcipher');

setLogger(() => {});

const rawKeyLiteral = key => {
	if (!Buffer.isBuffer(key) || key.byteLength !== 32) {
		throw new Error('The SQLCipher prototype requires a 32-byte Buffer key');
	}

	return `"x'${key.toString('hex')}'"`;
};

const rawKeyPragma = key => `key = ${rawKeyLiteral(key)}`;

class SqlCipherDriver {

	open(options) {
		this.db_ = new SqlCipherDatabase(options.name);
		this.db_.pragma(rawKeyPragma(options.key));
		this.db_.pragma('cipher_compatibility = 4');
		this.db_.pragma('temp_store = MEMORY');
		this.db_.pragma('secure_delete = ON');
		this.db_.pragma('foreign_keys = ON');
		this.db_.pragma('journal_mode = WAL');
	}

	close() {
		if (!this.db_) return;
		this.db_.close();
		this.db_ = null;
	}

	sqliteErrorToJsError(error, sql = null, params = null) {
		const message = [error.toString()];
		if (sql) message.push(sql);
		if (params) message.push(JSON.stringify(params));

		const output = new Error(message.join(': '));
		if (error.code) output.code = error.code;
		return output;
	}

	selectOne(sql, params = null) {
		return this.db_.prepare(sql).get(params || []);
	}

	selectAll(sql, params = null) {
		return this.db_.prepare(sql).all(params || []);
	}

	exec(sql, params = null) {
		return this.db_.prepare(sql).run(params || []);
	}

	lastInsertId() {
		throw new Error('NOT IMPLEMENTED');
	}

	cipherVersion() {
		return this.db_.pragma('cipher_version', { simple: true });
	}

	sqliteVersion() {
		return this.db_.prepare('SELECT sqlite_version() AS version').get().version;
	}

	compileOptions() {
		return this.db_.prepare('PRAGMA compile_options').all()
			.map(row => Object.values(row)[0]);
	}

	exportTo(targetPath, key) {
		const escapedTargetPath = targetPath.replaceAll('\'', '\'\'');
		this.db_.exec(`ATTACH DATABASE '${escapedTargetPath}' AS watchtower_backup KEY ${rawKeyLiteral(key)}`);
		try {
			this.db_.prepare('SELECT sqlcipher_export(?) AS result').get(['watchtower_backup']);
		} finally {
			this.db_.exec('DETACH DATABASE watchtower_backup');
		}
	}

	integrityCheck() {
		return this.db_.pragma('integrity_check', { simple: true });
	}

	checkpoint() {
		return this.db_.pragma('wal_checkpoint(TRUNCATE)');
	}
}

module.exports = { SqlCipherDriver, rawKeyLiteral, rawKeyPragma };
