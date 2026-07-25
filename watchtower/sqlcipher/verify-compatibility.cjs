const path = require('node:path');
const { createRequire } = require('node:module');

const packageRequire = createRequire(path.join(process.cwd(), 'package.json'));
const binding = packageRequire('@signalapp/sqlcipher');
binding.setLogger(() => {});

const database = new binding.default(':memory:');
const compileOptions = database.prepare('PRAGMA compile_options').all()
	.map(row => Object.values(row)[0]);
const requiredOptions = [
	'DQS=3',
	'ENABLE_FTS3',
	'ENABLE_FTS3_PARENTHESIS',
	'ENABLE_FTS4',
	'ENABLE_FTS5',
];
const missingOptions = requiredOptions.filter(option => !compileOptions.includes(option));
const memoryTempStore = compileOptions.some(
	option => option === 'TEMP_STORE=2' || option === 'TEMP_STORE=3',
);

database.exec('CREATE VIRTUAL TABLE watchtower_fts4_probe USING fts4(content)');
database.exec('CREATE VIRTUAL TABLE watchtower_fts5_probe USING fts5(content)');

const result = {
	sqlCipherVersion: database.pragma('cipher_version', { simple: true }),
	sqliteVersion: database.prepare('SELECT sqlite_version() AS version').get().version,
	requiredOptions,
	missingOptions,
	memoryTempStore,
};
database.close();

if (missingOptions.length || !memoryTempStore) {
	throw new Error('SQLCipher binding does not satisfy the encrypted profile contract');
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
