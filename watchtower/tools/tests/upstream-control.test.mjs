import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const commandPath = fileURLToPath(new URL('../upstream-control.mjs', import.meta.url));

const runCommand = (arguments_, environment) => new Promise(resolve => {
	const child = spawn(process.execPath, [commandPath, ...arguments_], {
		env: { ...process.env, ...environment },
	});
	let stdout = '';
	let stderr = '';
	child.stdout.on('data', chunk => stdout += chunk);
	child.stderr.on('data', chunk => stderr += chunk);
	child.on('close', status => resolve({ status, stdout, stderr }));
});

test('monitor reports only new stable releases and published advisories', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'watchtower-upstream-monitor-'));
	const policyPath = join(directory, 'policy.json');
	const snapshotPath = join(directory, 'snapshot.json');

	await writeFile(policyPath, JSON.stringify({
		schemaVersion: 1,
		upstream: {
			owner: 'laurent22',
			repository: 'joplin',
			baselineTag: 'v3.6.15',
		},
		monitoring: {
			advisoriesPublishedAfter: '2026-07-22T00:00:00.000Z',
		},
	}));
	await writeFile(snapshotPath, JSON.stringify({
		releases: [
			{ tag_name: 'v3.6.16', tag_commit: '1111111111111111111111111111111111111111', draft: false, prerelease: false, published_at: '2026-07-24T09:00:00Z', html_url: 'https://example.test/releases/v3.6.16' },
			{ tag_name: 'v3.7.0-beta', draft: false, prerelease: true, published_at: '2026-07-25T09:00:00Z', html_url: 'https://example.test/releases/v3.7.0-beta' },
			{ tag_name: 'v3.6.17', draft: true, prerelease: false, published_at: '2026-07-26T09:00:00Z', html_url: 'https://example.test/releases/v3.6.17' },
			{ tag_name: 'v3.6.15', draft: false, prerelease: false, published_at: '2026-06-20T09:00:00Z', html_url: 'https://example.test/releases/v3.6.15' },
		],
		advisories: [
			{ ghsa_id: 'GHSA-abcd-1234-efgh', state: 'published', withdrawn_at: null, severity: 'high', summary: 'Import path escape', published_at: '2026-07-23T10:00:00Z', html_url: 'https://example.test/advisories/GHSA-abcd-1234-efgh' },
			{ ghsa_id: 'GHSA-wxyz-1234-efgh', state: 'published', withdrawn_at: '2026-07-24T10:00:00Z', severity: 'critical', summary: 'Withdrawn report', published_at: '2026-07-23T10:00:00Z', html_url: 'https://example.test/advisories/GHSA-wxyz-1234-efgh' },
			{ ghsa_id: 'GHSA-old0-1234-efgh', state: 'published', withdrawn_at: null, severity: 'medium', summary: 'Already triaged', published_at: '2026-07-20T10:00:00Z', html_url: 'https://example.test/advisories/GHSA-old0-1234-efgh' },
		],
	}));

	const result = spawnSync(process.execPath, [
		commandPath,
		'monitor',
		'--policy',
		policyPath,
		'--snapshot',
		snapshotPath,
		'--dry-run',
	], { encoding: 'utf8' });

	assert.equal(result.status, 0, result.stderr);
	const output = JSON.parse(result.stdout);
	assert.deepEqual(output.candidates.map(candidate => ({
		key: candidate.key,
		title: candidate.title,
		sourceUrl: candidate.sourceUrl,
		syncBranch: candidate.syncBranch,
		upstreamCommit: candidate.upstreamCommit,
	})), [
		{
			key: 'advisory:GHSA-abcd-1234-efgh',
			title: '[Upstream advisory][HIGH] GHSA-abcd-1234-efgh: Import path escape',
			sourceUrl: 'https://example.test/advisories/GHSA-abcd-1234-efgh',
			syncBranch: undefined,
			upstreamCommit: undefined,
		},
		{
			key: 'release:v3.6.16',
			title: '[Upstream release] Evaluate Joplin v3.6.16',
			sourceUrl: 'https://example.test/releases/v3.6.16',
			syncBranch: 'sync/joplin-v3.6.16',
			upstreamCommit: '1111111111111111111111111111111111111111',
		},
	]);
});

test('monitor creates each upstream task once', async context => {
	const directory = await mkdtemp(join(tmpdir(), 'watchtower-upstream-live-'));
	const policyPath = join(directory, 'policy.json');
	await writeFile(policyPath, JSON.stringify({
		schemaVersion: 1,
		upstream: {
			owner: 'laurent22',
			repository: 'joplin',
			baselineTag: 'v3.6.15',
		},
		monitoring: {
			advisoriesPublishedAfter: '2026-07-22T00:00:00.000Z',
		},
		target: {
			repository: 'campbellmcgregor/watchtower-one',
		},
	}));

	const issues = [];
	const requests = [];
	const server = createServer(async (request, response) => {
		const body = await new Promise(resolve => {
			let value = '';
			request.on('data', chunk => value += chunk);
			request.on('end', () => resolve(value));
		});
		requests.push({
			method: request.method,
			path: request.url,
			authorization: request.headers.authorization,
		});

		response.setHeader('Content-Type', 'application/json');
		if (request.method === 'GET' && request.url === '/repos/laurent22/joplin/releases?per_page=100') {
			response.end(JSON.stringify([
				{ tag_name: 'v3.6.16', draft: false, prerelease: false, published_at: '2026-07-24T09:00:00Z', html_url: 'https://example.test/releases/v3.6.16' },
			]));
			return;
		}
		if (request.method === 'GET' && request.url === '/repos/laurent22/joplin/security-advisories?state=published&per_page=100') {
			response.end(JSON.stringify([
				{ ghsa_id: 'GHSA-abcd-1234-efgh', state: 'published', withdrawn_at: null, severity: 'high', summary: 'Import path escape', published_at: '2026-07-23T10:00:00Z', html_url: 'https://example.test/advisories/GHSA-abcd-1234-efgh' },
			]));
			return;
		}
		if (request.method === 'GET' && request.url === '/repos/laurent22/joplin/git/ref/tags/v3.6.16') {
			response.end(JSON.stringify({
				object: {
					type: 'commit',
					sha: '1111111111111111111111111111111111111111',
				},
			}));
			return;
		}
		if (request.method === 'GET' && request.url === '/repos/campbellmcgregor/watchtower-one/issues?state=all&per_page=100') {
			response.end(JSON.stringify(issues));
			return;
		}
		if (request.method === 'POST' && request.url === '/repos/campbellmcgregor/watchtower-one/issues') {
			const issue = { number: issues.length + 100, ...JSON.parse(body) };
			issues.push(issue);
			response.statusCode = 201;
			response.end(JSON.stringify(issue));
			return;
		}

		response.statusCode = 404;
		response.end(JSON.stringify({ message: 'Not Found' }));
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	context.after(() => server.close());
	const address = server.address();
	const environment = {
		WATCHTOWER_API_URL: `http://127.0.0.1:${address.port}`,
		WATCHTOWER_GITHUB_TOKEN: 'test-token',
	};

	const firstRun = await runCommand(['monitor', '--policy', policyPath], environment);
	const secondRun = await runCommand(['monitor', '--policy', policyPath], environment);

	assert.equal(firstRun.status, 0, firstRun.stderr);
	assert.equal(secondRun.status, 0, secondRun.stderr);
	assert.deepEqual(JSON.parse(firstRun.stdout), { created: 2, existing: 0 });
	assert.deepEqual(JSON.parse(secondRun.stdout), { created: 0, existing: 2 });
	assert.equal(issues.length, 2);
	assert.match(issues[0].body, /watchtower-upstream-candidate:/);
	assert.ok(issues.some(issue => issue.body.includes('sync/joplin-v3.6.16')));
	assert.ok(issues.some(issue => issue.body.includes('1111111111111111111111111111111111111111')));
	assert.ok(requests
		.filter(request => request.path.startsWith('/repos/laurent22/joplin/'))
		.every(request => request.authorization === undefined));
	assert.ok(requests
		.filter(request => request.method === 'POST')
		.every(request => request.authorization === 'Bearer test-token'));
});

test('verify-release accepts only an exact published stable tag', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'watchtower-upstream-verify-'));
	const policyPath = join(directory, 'policy.json');
	const snapshotPath = join(directory, 'snapshot.json');
	await writeFile(policyPath, JSON.stringify({
		schemaVersion: 1,
		upstream: {
			owner: 'laurent22',
			repository: 'joplin',
			baselineTag: 'v3.6.15',
		},
		monitoring: {
			advisoriesPublishedAfter: '2026-07-22T00:00:00.000Z',
		},
	}));
	await writeFile(snapshotPath, JSON.stringify({
		releases: [
			{ tag_name: 'v3.6.16', tag_commit: '1111111111111111111111111111111111111111', draft: false, prerelease: false, published_at: '2026-07-24T09:00:00Z', html_url: 'https://example.test/releases/v3.6.16' },
			{ tag_name: 'v3.7.0-beta', draft: false, prerelease: true, published_at: '2026-07-25T09:00:00Z', html_url: 'https://example.test/releases/v3.7.0-beta' },
		],
		advisories: [],
	}));

	const stable = spawnSync(process.execPath, [
		commandPath,
		'verify-release',
		'--policy',
		policyPath,
		'--snapshot',
		snapshotPath,
		'--tag',
		'v3.6.16',
		'--expected-sha',
		'1111111111111111111111111111111111111111',
	], { encoding: 'utf8' });
	const prerelease = spawnSync(process.execPath, [
		commandPath,
		'verify-release',
		'--policy',
		policyPath,
		'--snapshot',
		snapshotPath,
		'--tag',
		'v3.7.0-beta',
	], { encoding: 'utf8' });
	const unsafe = spawnSync(process.execPath, [
		commandPath,
		'verify-release',
		'--policy',
		policyPath,
		'--snapshot',
		snapshotPath,
		'--tag',
		'v3.6.16;whoami',
	], { encoding: 'utf8' });
	const retargeted = spawnSync(process.execPath, [
		commandPath,
		'verify-release',
		'--policy',
		policyPath,
		'--snapshot',
		snapshotPath,
		'--tag',
		'v3.6.16',
		'--expected-sha',
		'2222222222222222222222222222222222222222',
	], { encoding: 'utf8' });

	assert.equal(stable.status, 0, stable.stderr);
	assert.deepEqual(JSON.parse(stable.stdout), {
		upstreamTag: 'v3.6.16',
		syncBranch: 'sync/joplin-v3.6.16',
		sourceUrl: 'https://example.test/releases/v3.6.16',
		publishedAt: '2026-07-24T09:00:00Z',
		upstreamCommit: '1111111111111111111111111111111111111111',
	});
	assert.equal(prerelease.status, 1);
	assert.match(prerelease.stderr, /invalid stable tag|not a published stable release/i);
	assert.equal(unsafe.status, 1);
	assert.match(unsafe.stderr, /invalid stable tag/i);
	assert.equal(retargeted.status, 1);
	assert.match(retargeted.stderr, /unexpected tag retarget/i);
});

test('monitor finds an existing candidate beyond the first issue page', async context => {
	const directory = await mkdtemp(join(tmpdir(), 'watchtower-upstream-pages-'));
	const policyPath = join(directory, 'policy.json');
	await writeFile(policyPath, JSON.stringify({
		schemaVersion: 1,
		upstream: {
			owner: 'laurent22',
			repository: 'joplin',
			baselineTag: 'v3.6.15',
		},
		monitoring: {
			advisoriesPublishedAfter: '2026-07-22T00:00:00.000Z',
		},
		target: {
			repository: 'campbellmcgregor/watchtower-one',
		},
	}));

	let issueCreations = 0;
	const server = createServer((request, response) => {
		response.setHeader('Content-Type', 'application/json');
		if (request.url === '/repos/laurent22/joplin/releases?per_page=100') {
			response.end(JSON.stringify([
				{ tag_name: 'v3.6.16', draft: false, prerelease: false, published_at: '2026-07-24T09:00:00Z', html_url: 'https://example.test/releases/v3.6.16' },
			]));
			return;
		}
		if (request.url === '/repos/laurent22/joplin/security-advisories?state=published&per_page=100') {
			response.end('[]');
			return;
		}
		if (request.url === '/repos/laurent22/joplin/git/ref/tags/v3.6.16') {
			response.end(JSON.stringify({
				object: {
					type: 'commit',
					sha: '1111111111111111111111111111111111111111',
				},
			}));
			return;
		}
		if (request.method === 'GET' && request.url === '/repos/campbellmcgregor/watchtower-one/issues?state=all&per_page=100') {
			response.end(JSON.stringify(Array.from({ length: 100 }, (_, number) => ({
				number,
				body: `unrelated issue ${number}`,
			}))));
			return;
		}
		if (request.method === 'GET' && request.url === '/repos/campbellmcgregor/watchtower-one/issues?state=all&per_page=100&page=2') {
			response.end(JSON.stringify([{
				number: 101,
				body: '<!-- watchtower-upstream-candidate:release:v3.6.16 -->',
			}]));
			return;
		}
		if (request.method === 'POST') issueCreations += 1;
		response.statusCode = 404;
		response.end(JSON.stringify({ message: 'Not Found' }));
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	context.after(() => server.close());
	const address = server.address();

	const result = await runCommand(['monitor', '--policy', policyPath], {
		WATCHTOWER_API_URL: `http://127.0.0.1:${address.port}`,
		WATCHTOWER_GITHUB_TOKEN: 'test-token',
	});

	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(JSON.parse(result.stdout), { created: 0, existing: 1 });
	assert.equal(issueCreations, 0);
});

test('record-baseline advances the policy to an exact stable tag and commit', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'watchtower-upstream-baseline-'));
	const policyPath = join(directory, 'policy.json');
	await writeFile(policyPath, JSON.stringify({
		schemaVersion: 1,
		upstream: {
			owner: 'laurent22',
			repository: 'joplin',
			baselineTag: 'v3.6.15',
			baselineCommit: 'c61572660382863595c6b51ccf2263e3d2c4bfce',
		},
		monitoring: {
			advisoriesPublishedAfter: '2026-07-22T00:00:00.000Z',
		},
	}, null, 2));
	const nextCommit = '1234567890abcdef1234567890abcdef12345678';

	const result = spawnSync(process.execPath, [
		commandPath,
		'record-baseline',
		'--policy',
		policyPath,
		'--tag',
		'v3.6.16',
		'--sha',
		nextCommit,
	], { encoding: 'utf8' });
	const unsafe = spawnSync(process.execPath, [
		commandPath,
		'record-baseline',
		'--policy',
		policyPath,
		'--tag',
		'v3.6.17;whoami',
		'--sha',
		'not-a-commit',
	], { encoding: 'utf8' });

	assert.equal(result.status, 0, result.stderr);
	const policy = JSON.parse(await readFile(policyPath, 'utf8'));
	assert.equal(policy.upstream.baselineTag, 'v3.6.16');
	assert.equal(policy.upstream.baselineCommit, nextCommit);
	assert.equal(policy.monitoring.advisoriesPublishedAfter, '2026-07-22T00:00:00.000Z');
	assert.equal(unsafe.status, 1);
	assert.match(unsafe.stderr, /invalid stable tag|invalid commit/i);
});

test('verify-candidate-issue binds a release tag to its pinned commit', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'watchtower-candidate-issue-'));
	const issueBodyPath = join(directory, 'issue-body.md');
	const pinnedCommit = '1111111111111111111111111111111111111111';
	await writeFile(issueBodyPath, [
		'<!-- watchtower-upstream-candidate:release:v3.6.16 -->',
		'',
		'## Candidate',
		'',
		`- Exact commit: \`${pinnedCommit}\``,
	].join('\n'));

	const matching = spawnSync(process.execPath, [
		commandPath,
		'verify-candidate-issue',
		'--tag',
		'v3.6.16',
		'--issue-body',
		issueBodyPath,
	], { encoding: 'utf8' });
	const mismatched = spawnSync(process.execPath, [
		commandPath,
		'verify-candidate-issue',
		'--tag',
		'v3.6.17',
		'--issue-body',
		issueBodyPath,
	], { encoding: 'utf8' });

	assert.equal(matching.status, 0, matching.stderr);
	assert.deepEqual(JSON.parse(matching.stdout), {
		upstreamTag: 'v3.6.16',
		expectedCommit: pinnedCommit,
	});
	assert.equal(mismatched.status, 1);
	assert.match(mismatched.stderr, /not the candidate for v3\.6\.17/);
});
