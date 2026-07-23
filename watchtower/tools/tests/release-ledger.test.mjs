import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const commandPath = fileURLToPath(new URL('../release-ledger.mjs', import.meta.url));

const git = (repository, arguments_) => execFileSync('git', arguments_, {
	cwd: repository,
	encoding: 'utf8',
	env: {
		...process.env,
		GIT_AUTHOR_DATE: '2026-07-22T12:00:00Z',
		GIT_COMMITTER_DATE: '2026-07-22T12:00:00Z',
	},
}).trim();

test('generate records the exact downstream source and release artifacts', async () => {
	const repository = await mkdtemp(join(tmpdir(), 'watchtower-release-ledger-'));
	const artifactDirectory = join(repository, 'dist');
	const outputPath = join(repository, 'release-ledger.json');
	const patchRegistryPath = join(repository, 'watchtower-patches.json');
	await mkdir(artifactDirectory);

	git(repository, ['init', '--initial-branch=main']);
	git(repository, ['config', 'user.name', 'Watchtower Test']);
	git(repository, ['config', 'user.email', 'watchtower@example.test']);
	await writeFile(join(repository, 'yarn.lock'), 'lock\n');
	git(repository, ['add', 'yarn.lock']);
	git(repository, ['commit', '-m', 'upstream baseline']);
	const upstreamSha = git(repository, ['rev-parse', 'HEAD']);
	git(repository, ['tag', 'v3.6.15']);

	await writeFile(join(repository, 'watchtower.txt'), 'downstream patch\n');
	git(repository, ['add', 'watchtower.txt']);
	git(repository, ['commit', '-m', 'protect the profile']);
	const downstreamSha = git(repository, ['rev-parse', 'HEAD']);
	const patch = {
		id: 'profile-protection',
		owner: 'Watchtower security',
		commits: [downstreamSha],
		upstreamTouchpoints: ['packages/app-desktop'],
		tests: ['profile storage seam'],
		upstreamCandidate: false,
	};
	await writeFile(patchRegistryPath, `${JSON.stringify({
		schemaVersion: 1,
		patches: [patch],
	}, null, 2)}\n`);
	await writeFile(join(artifactDirectory, 'watchtower-a.bin'), 'artifact-a\n');
	await writeFile(join(artifactDirectory, 'watchtower-z.bin'), 'artifact-z\n');

	const result = spawnSync(process.execPath, [
		commandPath,
		'generate',
		'--repository',
		repository,
		'--upstream-tag',
		'v3.6.15',
		'--upstream-sha',
		upstreamSha,
		'--revision',
		'HEAD',
		'--lockfile',
		'yarn.lock',
		'--patch-registry',
		'watchtower-patches.json',
		'--artifact-directory',
		'dist',
		'--output',
		outputPath,
	], { encoding: 'utf8' });

	assert.equal(result.status, 0, result.stderr);
	const ledger = JSON.parse(await readFile(outputPath, 'utf8'));
	assert.deepEqual(ledger, {
		schemaVersion: 1,
		upstream: {
			repository: 'https://github.com/laurent22/joplin.git',
			tag: 'v3.6.15',
			commit: upstreamSha,
		},
		downstream: {
			revision: downstreamSha,
			commits: [
				{
					commit: downstreamSha,
					subject: 'protect the profile',
				},
			],
			patches: [patch],
		},
		lockfile: {
			path: 'yarn.lock',
			sha256: 'd8c9f2728aa278ebcd33ccedf3ad309a866870ad5fb93a03526b4b7655c9e911',
		},
		artifacts: [
			{
				path: 'dist/watchtower-a.bin',
				sha256: 'ebc3837f5ee487327e10d4224a9ea021d0a617722cdf5058ec31b54f6603d8e4',
			},
			{
				path: 'dist/watchtower-z.bin',
				sha256: 'dafa31067c8fb1b69d1cbda34d7f392ac80e6e196d10afc51cfa31764acf3d12',
			},
		],
	});
	assert.equal(result.stdout.trim(), outputPath);
});

test('generate permits an artifact-free integration ledger only when explicitly allowed', async () => {
	const repository = await mkdtemp(join(tmpdir(), 'watchtower-integration-ledger-'));
	const outputPath = join(repository, 'integration-ledger.json');
	const patchRegistryPath = join(repository, 'watchtower-patches.json');
	await writeFile(join(repository, 'yarn.lock'), 'lock\n');
	await writeFile(patchRegistryPath, JSON.stringify({ schemaVersion: 1, patches: [] }));
	git(repository, ['init', '--initial-branch=main']);
	git(repository, ['config', 'user.name', 'Watchtower Test']);
	git(repository, ['config', 'user.email', 'watchtower@example.test']);
	git(repository, ['add', 'yarn.lock']);
	git(repository, ['commit', '-m', 'upstream baseline']);
	const upstreamSha = git(repository, ['rev-parse', 'HEAD']);
	git(repository, ['tag', 'v3.6.15']);

	const baseArguments = [
		commandPath,
		'generate',
		'--repository',
		repository,
		'--upstream-tag',
		'v3.6.15',
		'--upstream-sha',
		upstreamSha,
		'--revision',
		'HEAD',
		'--lockfile',
		'yarn.lock',
		'--patch-registry',
		'watchtower-patches.json',
		'--output',
		outputPath,
	];
	const releaseAttempt = spawnSync(process.execPath, baseArguments, { encoding: 'utf8' });
	const integrationAttempt = spawnSync(process.execPath, [
		...baseArguments,
		'--allow-no-artifacts',
	], { encoding: 'utf8' });

	assert.equal(releaseAttempt.status, 1);
	assert.match(releaseAttempt.stderr, /at least one --artifact/i);
	assert.equal(integrationAttempt.status, 0, integrationAttempt.stderr);
	const ledger = JSON.parse(await readFile(outputPath, 'utf8'));
	assert.deepEqual(ledger.artifacts, []);
});
