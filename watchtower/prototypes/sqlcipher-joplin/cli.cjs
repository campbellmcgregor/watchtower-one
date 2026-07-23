#!/usr/bin/env node

const { runProof } = require('./proof.cjs');

const argumentValue = name => {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : null;
};

const mark = value => value ? '[PASS]' : '[FAIL]';
const line = (label, value) => console.log(`${label.padEnd(34)} ${value}`);

const render = result => {
	console.log('');
	console.log('Watchtower One — disposable SQLCipher/Joplin proof');
	console.log('==================================================');
	line('Joplin migrations', `${mark(result.joplinMigration)} schema ${result.joplinSchemaVersion}`);
	line('SQLCipher runtime', `${mark(Boolean(result.cipherVersion))} ${result.cipherVersion}`);
	line('Joplin SQLite compile options', `${mark(result.missingCompileOptions.length === 0)} ${result.requiredCompileOptions.join(', ')}`);
	line('Wrong key rejected', mark(result.wrongKeyRejected));
	line('Note persisted', mark(result.persistence.note));
	line('Sensitive setting persisted', mark(result.persistence.setting));
	line('Plugin value persisted', mark(result.persistence.plugin));
	line('Resource BLOB persisted', `${mark(result.persistence.resource)} ${result.resource.bytes} bytes`);
	line('Rollback atomic', mark(result.rollbackAtomic));
	line('Plaintext canary matches', `${mark(result.canaryScan.matches.length === 0)} ${result.canaryScan.matches.length}`);
	line('Encrypted backup + restore', mark(
		result.backup.integrity
		&& result.backup.wrongKeyRejected
		&& Object.values(result.backup.persistence).every(Boolean),
	));
	line('Backup plaintext matches', `${mark(result.backup.canaryScan.matches.length === 0)} ${result.backup.canaryScan.matches.length}`);
	line('Committed write after kill', mark(result.crash.committedWriteSurvived));
	line('In-flight rollback after kill', mark(result.crash.inflightWriteRolledBack));
	line('Crash recovery integrity', mark(
		result.crash.integrityAfterCommittedKill
		&& result.crash.integrityAfterInflightKill,
	));
	line('Crash plaintext matches', `${mark(result.crash.canaryScan.matches.length === 0)} ${result.crash.canaryScan.matches.length}`);
	line('Schema 48 → current upgrade', `${mark(result.upgrade.newColumnPresent && result.upgrade.integrity)} ${result.upgrade.toVersion}`);
	line('Prototype key persisted', `${mark(result.keyPersisted === false)} no`);
	line('Migration time', `${result.timingsMs.migration} ms`);
	line('Insert time', `${result.timingsMs.insert} ms`);
	line('Reopen + verify time', `${result.timingsMs.reopenAndVerify} ms`);
	line('Scratch evidence', result.scratchRoot);
	console.log('');
	console.log('PROTOTYPE ONLY — the scratch directory is intentionally retained and may be deleted.');
};

const main = async () => {
	const attachmentMiB = Number(argumentValue('--attachment-mib') || 1);
	const json = process.argv.includes('--json');

	try {
		const result = await runProof({ attachmentMiB });
		if (json) {
			console.log(JSON.stringify(result, null, 2));
		} else {
			render(result);
		}
	} catch (error) {
		if (json && error.result) {
			console.error(JSON.stringify({ error: error.message, result: error.result }, null, 2));
		} else {
			console.error(`\n[FAIL] ${error.stack || error}`);
			if (error.result?.scratchRoot) console.error(`Scratch evidence: ${error.result.scratchRoot}`);
		}
		process.exitCode = 1;
	}
};

void main();
