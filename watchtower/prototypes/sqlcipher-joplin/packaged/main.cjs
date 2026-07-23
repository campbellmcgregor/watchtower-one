const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

process.env['@SIGNALAPP/SQLCIPHER_PREBUILD'] = path.join(
	process.resourcesPath,
	'sqlcipher-prebuild',
);

const { default: Database, setLogger } = require('@signalapp/sqlcipher');

setLogger(() => {});
app.disableHardwareAcceleration();

const main = () => {
	const databasePath = path.join(process.resourcesPath, `packaged-proof-${process.pid}.sqlite`);
	const key = crypto.randomBytes(32);
	const canary = 'WATCHTOWER_PACKAGED_SQLCIPHER_CANARY_F09C2370';
	let database = new Database(databasePath);

	try {
		database.pragma(`key = "x'${key.toString('hex')}'"`);
		database.exec('CREATE TABLE packaged_probe (content TEXT NOT NULL)');
		database.prepare('INSERT INTO packaged_probe (content) VALUES (?)').run([canary]);
		const cipherVersion = database.pragma('cipher_version', { simple: true });
		const compileOptions = database.prepare('PRAGMA compile_options').all()
			.map(row => Object.values(row)[0])
			.filter(option => /DQS|FTS/.test(option));
		database.close();

		database = new Database(databasePath);
		database.pragma(`key = "x'${key.toString('hex')}'"`);
		const row = database.prepare('SELECT content FROM packaged_probe LIMIT 1').get();
		database.close();

		const rawCanaryMatches = fs.readFileSync(databasePath).includes(Buffer.from(canary, 'utf8')) ? 1 : 0;
		const result = {
			packaged: app.isPackaged,
			electronVersion: process.versions.electron,
			nodeVersion: process.versions.node,
			cipherVersion,
			compileOptions,
			reopenPassed: row?.content === canary,
			rawCanaryMatches,
			resourcesPath: process.resourcesPath,
		};

		fs.writeFileSync(
			path.join(process.resourcesPath, 'packaged-proof-result.json'),
			`${JSON.stringify(result, null, 2)}\n`,
		);
		if (!result.packaged || !result.reopenPassed || result.rawCanaryMatches) process.exitCode = 1;
	} catch (error) {
		fs.writeFileSync(
			path.join(process.resourcesPath, 'packaged-proof-error.txt'),
			`${error.stack || error}\n`,
		);
		process.exitCode = 1;
	} finally {
		try {
			database.close();
		} catch {
			// Best-effort close in a disposable proof.
		}
		key.fill(0);
		app.quit();
	}
};

app.whenReady().then(main);
