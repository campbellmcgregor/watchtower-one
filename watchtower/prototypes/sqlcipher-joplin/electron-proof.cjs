const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');
const { SqlCipherDriver } = require('./sqlcipher-driver.cjs');

app.disableHardwareAcceleration();

const main = async () => {
	const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'WatchtowerOne-ELECTRON-SQLCIPHER-PROTOTYPE-WIPE-ME-'));
	const databasePath = path.join(scratchRoot, 'electron-runtime.sqlite');
	const key = crypto.randomBytes(32);
	const canary = 'WATCHTOWER_ELECTRON_RUNTIME_CANARY_FF62C398';
	let driver = new SqlCipherDriver();

	try {
		driver.open({ name: databasePath, key });
		driver.exec('CREATE TABLE runtime_probe (content TEXT NOT NULL)');
		driver.exec('INSERT INTO runtime_probe (content) VALUES (?)', [canary]);
		const cipherVersion = driver.cipherVersion();
		const compileOptions = driver.compileOptions();
		driver.close();

		driver = new SqlCipherDriver();
		driver.open({ name: databasePath, key });
		const row = driver.selectOne('SELECT content FROM runtime_probe LIMIT 1');
		driver.close();

		const rawMatch = fs.readFileSync(databasePath).includes(Buffer.from(canary, 'utf8'));
		const result = {
			electronVersion: process.versions.electron,
			nodeVersion: process.versions.node,
			cipherVersion,
			compileOptions: compileOptions.filter(option => /DQS|FTS/.test(option)),
			reopenPassed: row?.content === canary,
			rawCanaryMatches: rawMatch ? 1 : 0,
			scratchRoot,
		};

		process.stdout.write(`WATCHTOWER_ELECTRON_PROOF=${JSON.stringify(result)}\n`);
		if (!result.reopenPassed || result.rawCanaryMatches) process.exitCode = 1;
	} catch (error) {
		process.stderr.write(`${error.stack || error}\n`);
		process.exitCode = 1;
	} finally {
		try {
			driver.close();
		} catch {
			// Best-effort close in a disposable proof.
		}
		key.fill(0);
		app.quit();
	}
};

app.whenReady().then(main);
