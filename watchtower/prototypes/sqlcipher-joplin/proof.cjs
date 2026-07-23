const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const JoplinDatabase = require('../../../packages/lib/JoplinDatabase.js').default;
const { SqlCipherDriver } = require('./sqlcipher-driver.cjs');

const NOTE_CANARY = 'WATCHTOWER_NOTE_PLAINTEXT_CANARY_8EAC7B68';
const SETTING_CANARY = 'WATCHTOWER_SETTING_PLAINTEXT_CANARY_94EB06D2';
const PLUGIN_CANARY = 'WATCHTOWER_PLUGIN_PLAINTEXT_CANARY_34290F64';
const RESOURCE_CANARY = 'WATCHTOWER_RESOURCE_PLAINTEXT_CANARY_C975774A';
const ROLLBACK_CANARY = 'WATCHTOWER_ROLLBACK_CANARY_5E8CCAB0';

const now = () => Date.now();
const elapsed = startedAt => Date.now() - startedAt;
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

const makeResource = sizeMiB => {
	const size = sizeMiB * 1024 * 1024;
	const output = crypto.randomBytes(size);
	const canary = Buffer.from(RESOURCE_CANARY, 'utf8');
	canary.copy(output, Math.floor((size - canary.length) / 2));
	return output;
};

const scanForCanaries = databasePath => {
	const directory = path.dirname(databasePath);
	const basename = path.basename(databasePath);
	const candidates = fs.readdirSync(directory)
		.filter(name => name.startsWith(basename))
		.map(name => path.join(directory, name));
	const canaries = [NOTE_CANARY, SETTING_CANARY, PLUGIN_CANARY, RESOURCE_CANARY];
	const matches = [];

	for (const candidate of candidates) {
		const bytes = fs.readFileSync(candidate);
		for (const canary of canaries) {
			if (bytes.includes(Buffer.from(canary, 'utf8'))) {
				matches.push({ file: path.basename(candidate), canary });
			}
		}
	}

	return {
		files: candidates.map(candidate => ({
			name: path.basename(candidate),
			bytes: fs.statSync(candidate).size,
		})),
		matches,
	};
};

const openJoplinDatabase = async (databasePath, key) => {
	const driver = new SqlCipherDriver();
	const database = new JoplinDatabase(driver);
	await database.open({ name: databasePath, key });
	return { database, driver };
};

const insertProofData = async (database, attachmentMiB) => {
	const timestamp = Date.now();
	const resource = makeResource(attachmentMiB);
	const resourceHash = sha256(resource);

	await database.exec(
		'INSERT INTO notes (id, parent_id, title, body, created_time, updated_time) VALUES (?, ?, ?, ?, ?, ?)',
		['watchtower-note', '', 'Watchtower SQLCipher prototype', NOTE_CANARY, timestamp, timestamp],
	);
	await database.exec(
		'INSERT INTO settings (`key`, `value`, `type`) VALUES (?, ?, ?)',
		['watchtower.prototype.sensitive-setting', SETTING_CANARY, 2],
	);
	await database.exec(`
		CREATE TABLE watchtower_plugin_settings (
			plugin_id TEXT NOT NULL,
			setting_key TEXT NOT NULL,
			setting_value TEXT NOT NULL,
			PRIMARY KEY (plugin_id, setting_key)
		)
	`);
	await database.exec(
		'INSERT INTO watchtower_plugin_settings (plugin_id, setting_key, setting_value) VALUES (?, ?, ?)',
		['watchtower.prototype-plugin', 'secret', PLUGIN_CANARY],
	);
	await database.exec(`
		CREATE TABLE watchtower_resource_blobs (
			resource_id TEXT PRIMARY KEY,
			content BLOB NOT NULL,
			size INTEGER NOT NULL,
			sha256 TEXT NOT NULL
		)
	`);
	await database.exec(
		'INSERT INTO watchtower_resource_blobs (resource_id, content, size, sha256) VALUES (?, ?, ?, ?)',
		['watchtower-resource', resource, resource.byteLength, resourceHash],
	);

	return { resourceHash, resourceSize: resource.byteLength };
};

const verifyProofData = async (database, expectedHash) => {
	const note = await database.selectOne('SELECT body FROM notes WHERE id = ?', ['watchtower-note']);
	const setting = await database.selectOne('SELECT value FROM settings WHERE `key` = ?', ['watchtower.prototype.sensitive-setting']);
	const plugin = await database.selectOne(
		'SELECT setting_value FROM watchtower_plugin_settings WHERE plugin_id = ? AND setting_key = ?',
		['watchtower.prototype-plugin', 'secret'],
	);
	const resource = await database.selectOne(
		'SELECT content, size, sha256 FROM watchtower_resource_blobs WHERE resource_id = ?',
		['watchtower-resource'],
	);

	return {
		note: note?.body === NOTE_CANARY,
		setting: setting?.value === SETTING_CANARY,
		plugin: plugin?.setting_value === PLUGIN_CANARY,
		resource: resource?.sha256 === expectedHash
			&& Number(resource?.size) === resource?.content?.byteLength
			&& sha256(Buffer.from(resource.content)) === expectedHash,
	};
};

const wrongKeyIsRejected = async databasePath => {
	let opened = null;
	try {
		opened = await openJoplinDatabase(databasePath, crypto.randomBytes(32));
		return false;
	} catch (error) {
		return /file is not a database|not a database|encrypted/i.test(String(error));
	} finally {
		await opened?.database.close();
	}
};

const rollbackIsAtomic = async database => {
	await database.exec('BEGIN TRANSACTION');
	try {
		await database.exec(
			'INSERT INTO settings (`key`, `value`, `type`) VALUES (?, ?, ?)',
			['watchtower.prototype.rollback', ROLLBACK_CANARY, 2],
		);
		await database.exec('ROLLBACK');
	} catch (error) {
		await database.exec('ROLLBACK');
		throw error;
	}

	const row = await database.selectOne(
		'SELECT value FROM settings WHERE `key` = ?',
		['watchtower.prototype.rollback'],
	);
	return !row;
};

const assertProof = result => {
	const failures = [];
	if (!result.joplinMigration) failures.push('Joplin schema migration');
	if (!result.wrongKeyRejected) failures.push('wrong-key rejection');
	if (result.canaryScan.matches.length) failures.push('raw-file canary scan');
	for (const [field, passed] of Object.entries(result.persistence)) {
		if (!passed) failures.push(`${field} persistence`);
	}
	if (!result.rollbackAtomic) failures.push('transaction rollback');

	if (failures.length) {
		const error = new Error(`SQLCipher prototype failed: ${failures.join(', ')}`);
		error.result = result;
		throw error;
	}
};

const runProof = async ({ attachmentMiB = 1, scratchParent = os.tmpdir() } = {}) => {
	const runStartedAt = now();
	const scratchRoot = fs.mkdtempSync(path.join(scratchParent, 'WatchtowerOne-SQLCipher-PROTOTYPE-WIPE-ME-'));
	const databasePath = path.join(scratchRoot, 'watchtower-profile.sqlite');
	const key = crypto.randomBytes(32);
	let opened = null;
	let result = null;

	try {
		const migrationStartedAt = now();
		opened = await openJoplinDatabase(databasePath, key);
		const migrationMs = elapsed(migrationStartedAt);
		const schemaVersion = opened.database.version();
		const cipherVersion = opened.driver.cipherVersion();
		const sqliteVersion = opened.driver.sqliteVersion();

		const insertStartedAt = now();
		const inserted = await insertProofData(opened.database, attachmentMiB);
		const insertMs = elapsed(insertStartedAt);
		opened.driver.checkpoint();
		await opened.database.close();
		opened = null;

		const canaryScan = scanForCanaries(databasePath);
		const wrongKeyRejected = await wrongKeyIsRejected(databasePath);

		const reopenStartedAt = now();
		opened = await openJoplinDatabase(databasePath, key);
		const persistence = await verifyProofData(opened.database, inserted.resourceHash);
		const rollbackAtomic = await rollbackIsAtomic(opened.database);
		opened.driver.checkpoint();
		const reopenAndVerifyMs = elapsed(reopenStartedAt);
		await opened.database.close();
		opened = null;

		result = {
			prototype: true,
			disposable: true,
			scratchRoot,
			databasePath,
			keyPersisted: false,
			cipherVersion,
			sqliteVersion,
			joplinSchemaVersion: schemaVersion,
			joplinMigration: Number(schemaVersion) > 0,
			wrongKeyRejected,
			canaryScan,
			persistence,
			rollbackAtomic,
			resource: {
				bytes: inserted.resourceSize,
				sha256: inserted.resourceHash,
			},
			timingsMs: {
				migration: migrationMs,
				insert: insertMs,
				reopenAndVerify: reopenAndVerifyMs,
				total: elapsed(runStartedAt),
			},
		};

		assertProof(result);
		return result;
	} catch (error) {
		if (!error.result) {
			error.result = {
				...result,
				prototype: true,
				disposable: true,
				scratchRoot,
				databasePath,
				keyPersisted: false,
			};
		}
		throw error;
	} finally {
		await opened?.database.close();
		key.fill(0);
	}
};

module.exports = {
	NOTE_CANARY,
	PLUGIN_CANARY,
	RESOURCE_CANARY,
	SETTING_CANARY,
	runProof,
};
