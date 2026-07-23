const path = require('node:path');
const { createRequire } = require('node:module');

const desktopRequire = createRequire(path.resolve(__dirname, '../../../packages/app-desktop/package.json'));
const { default: SqlCipherDatabase, setLogger } = desktopRequire('@signalapp/sqlcipher');

setLogger(() => {});

const rawKeyPragma = key => {
	if (!Buffer.isBuffer(key) || key.byteLength !== 32) {
		throw new Error('The SQLCipher prototype requires a 32-byte Buffer key');
	}

	return `key = "x'${key.toString('hex')}'"`;
};

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

	checkpoint() {
		return this.db_.pragma('wal_checkpoint(TRUNCATE)');
	}
}

module.exports = { SqlCipherDriver, rawKeyPragma };
