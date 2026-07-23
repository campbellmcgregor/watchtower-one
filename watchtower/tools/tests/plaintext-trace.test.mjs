import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const commandPath = fileURLToPath(new URL('../plaintext-trace.mjs', import.meta.url));

test('snapshot records deterministic hashes and literal canary locations', async () => {
	const temporaryDirectory = await mkdtemp(join(tmpdir(), 'watchtower-plaintext-trace-'));
	const profileDirectory = join(temporaryDirectory, 'profile');
	const externalDirectory = join(temporaryDirectory, 'external');
	const outputPath = join(temporaryDirectory, 'snapshot.json');
	await mkdir(join(profileDirectory, 'nested'), { recursive: true });
	await mkdir(externalDirectory, { recursive: true });
	await writeFile(join(profileDirectory, 'hash.txt'), 'abc');
	await writeFile(join(profileDirectory, 'nested', 'note.txt'), 'prefix WT-NOTE-CANARY suffix');
	await writeFile(
		join(profileDirectory, 'stream-boundary.bin'),
		Buffer.concat([Buffer.alloc(65_530, 0x78), Buffer.from('WT-NOTE-CANARY')]),
	);
	await writeFile(
		join(externalDirectory, 'wide.txt'),
		Buffer.from('WT-NOTE-CANARY', 'utf16le'),
	);

	const result = spawnSync(process.execPath, [
		commandPath,
		'snapshot',
		'--scenario',
		'note-resource',
		'--root',
		`profile=${profileDirectory}`,
		'--root',
		`external=${externalDirectory}`,
		'--canary',
		'note=WT-NOTE-CANARY',
		'--output',
		outputPath,
	], { encoding: 'utf8' });

	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stdout.trim(), outputPath);
	const manifest = JSON.parse(await readFile(outputPath, 'utf8'));
	assert.equal(manifest.schemaVersion, 1);
	assert.equal(manifest.scenario, 'note-resource');
	assert.deepEqual(
		manifest.files.map(file => `${file.root}/${file.path}`),
		[
			'external/wide.txt',
			'profile/hash.txt',
			'profile/nested/note.txt',
			'profile/stream-boundary.bin',
		],
	);
	assert.equal(
		manifest.files.find(file => file.path === 'hash.txt').sha256,
		'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
	);
	assert.deepEqual(
		manifest.files.filter(file => file.canaries.length).map(file => ({
			location: `${file.root}/${file.path}`,
			canaries: file.canaries,
		})),
		[
			{
				location: 'external/wide.txt',
				canaries: [{ id: 'note', encodings: ['utf16le'] }],
			},
			{
				location: 'profile/nested/note.txt',
				canaries: [{ id: 'note', encodings: ['utf8'] }],
			},
			{
				location: 'profile/stream-boundary.bin',
				canaries: [{ id: 'note', encodings: ['utf8'] }],
			},
		],
	);
	assert.deepEqual(manifest.errors, []);
});
