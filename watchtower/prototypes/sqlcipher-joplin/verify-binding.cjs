const path = require('node:path');
const { createRequire } = require('node:module');

const packageRoot = process.cwd();
const packageRequire = createRequire(path.join(packageRoot, 'package.json'));
const { default: Database, setLogger } = packageRequire('@signalapp/sqlcipher');

setLogger(() => {});

const database = new Database(':memory:');
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

database.exec('CREATE VIRTUAL TABLE watchtower_fts4_probe USING fts4(content)');
database.exec('CREATE VIRTUAL TABLE watchtower_fts5_probe USING fts5(content)');

const result = {
	sqlCipherVersion: database.pragma('cipher_version', { simple: true }),
	sqliteVersion: database.prepare('SELECT sqlite_version() AS version').get().version,
	requiredOptions,
	missingOptions,
};

database.close();

if (missingOptions.length) {
	throw new Error(`Missing required Joplin compatibility options: ${missingOptions.join(', ')}`);
}

console.log(JSON.stringify(result, null, 2));
