const readline = require('node:readline');
const { SqlCipherDriver } = require('./sqlcipher-driver.cjs');

const input = readline.createInterface({
	input: process.stdin,
	crlfDelay: Infinity,
});

input.once('line', line => {
	const command = JSON.parse(line);
	const key = Buffer.from(command.keyHex, 'hex');
	const driver = new SqlCipherDriver();

	try {
		driver.open({ name: command.databasePath, key });

		if (command.mode === 'committed') {
			driver.exec(
				'INSERT INTO watchtower_crash_probe (probe_key, probe_value) VALUES (?, ?)',
				['committed', command.canary],
			);
			process.stdout.write('COMMITTED\n');
		} else if (command.mode === 'inflight') {
			driver.exec('BEGIN IMMEDIATE');
			driver.exec(
				'INSERT INTO watchtower_crash_probe (probe_key, probe_value) VALUES (?, ?)',
				['inflight', command.canary],
			);
			process.stdout.write('INFLIGHT\n');
		} else {
			throw new Error(`Unknown crash-probe mode: ${command.mode}`);
		}

		key.fill(0);
		setInterval(() => {}, 60_000);
	} catch (error) {
		key.fill(0);
		process.stderr.write(`${error.stack || error}\n`);
		process.exitCode = 1;
	}
});
