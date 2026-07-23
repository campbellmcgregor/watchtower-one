import { readFile, writeFile } from 'node:fs/promises';

const parseArguments = arguments_ => {
	const [command, ...tokens] = arguments_;
	const options = {};

	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);

		const name = token.slice(2);
		if (name === 'dry-run') {
			options.dryRun = true;
			continue;
		}

		const value = tokens[index + 1];
		if (!value || value.startsWith('--')) throw new Error(`Missing value for --${name}`);
		options[name] = value;
		index += 1;
	}

	return { command, options };
};

const readJson = async path => JSON.parse(await readFile(path, 'utf8'));

const requestJson = async (url, { method = 'GET', token, body } = {}) => {
	const headers = {
		Accept: 'application/vnd.github+json',
		'X-GitHub-Api-Version': '2022-11-28',
	};
	if (token) headers.Authorization = `Bearer ${token}`;
	if (body) headers['Content-Type'] = 'application/json';

	const response = await fetch(url, {
		method,
		headers,
		body: body ? JSON.stringify(body) : undefined,
	});
	if (!response.ok) {
		throw new Error(`GitHub API ${method} ${url} failed (${response.status}): ${await response.text()}`);
	}
	return response.json();
};

const requestAllPages = async (url, { token } = {}) => {
	const items = [];
	for (let page = 1; ; page += 1) {
		const pageUrl = page === 1 ? url : `${url}&page=${page}`;
		const values = await requestJson(pageUrl, { token });
		if (!Array.isArray(values)) throw new Error(`Expected an array from ${pageUrl}`);
		items.push(...values);
		if (values.length < 100) return items;
	}
};

const parseStableTag = tag => {
	const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag);
	return match ? match.slice(1).map(value => Number.parseInt(value, 10)) : null;
};

const compareVersions = (left, right) => {
	for (let index = 0; index < left.length; index += 1) {
		if (left[index] !== right[index]) return left[index] - right[index];
	}
	return 0;
};

const releaseCandidates = (releases, policy) => {
	const baselineVersion = parseStableTag(policy.upstream.baselineTag);
	if (!baselineVersion) throw new Error(`Invalid baseline tag: ${policy.upstream.baselineTag}`);

	return releases.flatMap(release => {
		const version = parseStableTag(release.tag_name);
		if (!version || release.draft || release.prerelease || !release.published_at) return [];
		if (compareVersions(version, baselineVersion) <= 0) return [];

		const key = `release:${release.tag_name}`;
		return [{
			kind: 'release',
			key,
			marker: `<!-- watchtower-upstream-candidate:${key} -->`,
			title: `[Upstream release] Evaluate Joplin ${release.tag_name}`,
			sourceUrl: release.html_url,
			publishedAt: release.published_at,
			upstreamTag: release.tag_name,
			syncBranch: `sync/joplin-${release.tag_name}`,
		}];
	});
};

const advisoryCandidates = (advisories, policy) => {
	const publishedAfter = Date.parse(policy.monitoring.advisoriesPublishedAfter);
	if (Number.isNaN(publishedAfter)) {
		throw new Error(`Invalid advisory cutoff: ${policy.monitoring.advisoriesPublishedAfter}`);
	}

	return advisories.flatMap(advisory => {
		const publishedAt = Date.parse(advisory.published_at);
		if (
			advisory.state !== 'published'
			|| advisory.withdrawn_at
			|| !advisory.ghsa_id
			|| Number.isNaN(publishedAt)
			|| publishedAt <= publishedAfter
		) return [];

		const key = `advisory:${advisory.ghsa_id}`;
		const severity = String(advisory.severity || 'unknown').toLowerCase();
		return [{
			kind: 'advisory',
			key,
			marker: `<!-- watchtower-upstream-candidate:${key} -->`,
			title: `[Upstream advisory][${severity.toUpperCase()}] ${advisory.ghsa_id}: ${advisory.summary}`,
			sourceUrl: advisory.html_url,
			publishedAt: advisory.published_at,
			severity,
		}];
	});
};

const releaseIssueBody = candidate => `${candidate.marker}

## Candidate

- Source: ${candidate.sourceUrl}
- Published: ${candidate.publishedAt}
- Exact tag: \`${candidate.upstreamTag}\`
- Required branch: \`${candidate.syncBranch}\`

## Reviewed synchronization

- [ ] Confirm GitHub still marks the release as non-draft and non-prerelease.
- [ ] Resolve the tag to its full commit SHA and fetch only that exact tag.
- [ ] Branch from protected Watchtower \`main\` using the required synchronization branch.
- [ ] Merge the upstream tag without rebasing published Watchtower history.
- [ ] Review storage, migrations, encryption, sync, import/export, plugins, Electron, React Native, and packaging changes.
- [ ] Regenerate the patch ledger and run affected upstream plus Watchtower verification.
- [ ] Integrate through a reviewed pull request; never force-push a published Watchtower release.
`;

const advisoryIssueBody = candidate => `${candidate.marker}

## Advisory

- Source: ${candidate.sourceUrl}
- Published: ${candidate.publishedAt}
- Severity: **${candidate.severity.toUpperCase()}**

## Triage

- [ ] Determine whether shipped or planned Watchtower code is affected.
- [ ] Identify patched upstream tags or commits.
- [ ] For critical/high impact, triage the same business day and start an emergency synchronization branch when affected.
- [ ] Record the decision and evidence before closing this task.
`;

const issueBody = candidate => candidate.kind === 'release'
	? releaseIssueBody(candidate)
	: advisoryIssueBody(candidate);

const liveSnapshot = async (apiUrl, policy) => {
	const upstreamRepository = `${policy.upstream.owner}/${policy.upstream.repository}`;
	const [releases, advisories] = await Promise.all([
		requestAllPages(`${apiUrl}/repos/${upstreamRepository}/releases?per_page=100`),
		requestAllPages(`${apiUrl}/repos/${upstreamRepository}/security-advisories?state=published&per_page=100`),
	]);
	return { releases, advisories };
};

const reconcileIssues = async (apiUrl, targetRepository, token, candidates) => {
	if (!token) throw new Error('WATCHTOWER_GITHUB_TOKEN is required for live reconciliation');
	if (!/^[^/]+\/[^/]+$/.test(targetRepository || '')) {
		throw new Error('target.repository must be an owner/repository name');
	}

	const issueUrl = `${apiUrl}/repos/${targetRepository}/issues`;
	const existingIssues = await requestAllPages(`${issueUrl}?state=all&per_page=100`, { token });
	const existingBodies = existingIssues.map(issue => issue.body || '');
	let created = 0;
	let existing = 0;

	for (const candidate of candidates) {
		if (existingBodies.some(body => body.includes(candidate.marker))) {
			existing += 1;
			continue;
		}

		await requestJson(issueUrl, {
			method: 'POST',
			token,
			body: {
				title: candidate.title,
				body: issueBody(candidate),
			},
		});
		existingBodies.push(candidate.marker);
		created += 1;
	}

	return { created, existing };
};

const monitor = async options => {
	if (!options.policy) throw new Error('--policy is required');
	if (options.dryRun && !options.snapshot) throw new Error('--snapshot is required in dry-run mode');

	const policy = await readJson(options.policy);
	const apiUrl = (process.env.WATCHTOWER_API_URL || 'https://api.github.com').replace(/\/$/, '');
	const snapshot = options.snapshot
		? await readJson(options.snapshot)
		: await liveSnapshot(apiUrl, policy);
	const candidates = [
		...releaseCandidates(snapshot.releases || [], policy),
		...advisoryCandidates(snapshot.advisories || [], policy),
	].sort((left, right) => left.key.localeCompare(right.key));

	const result = options.dryRun
		? { candidates }
		: await reconcileIssues(
			apiUrl,
			policy.target?.repository || process.env.GITHUB_REPOSITORY,
			process.env.WATCHTOWER_GITHUB_TOKEN,
			candidates,
		);
	process.stdout.write(`${JSON.stringify(result, null, options.dryRun ? 2 : 0)}\n`);
};

const verifyRelease = async options => {
	if (!options.policy) throw new Error('--policy is required');
	if (!options.tag) throw new Error('--tag is required');

	const requestedVersion = parseStableTag(options.tag);
	if (!requestedVersion) throw new Error(`Invalid stable tag: ${options.tag}`);

	const policy = await readJson(options.policy);
	const baselineVersion = parseStableTag(policy.upstream.baselineTag);
	if (!baselineVersion) throw new Error(`Invalid baseline tag: ${policy.upstream.baselineTag}`);
	if (compareVersions(requestedVersion, baselineVersion) <= 0) {
		throw new Error(`${options.tag} is not newer than baseline ${policy.upstream.baselineTag}`);
	}

	const apiUrl = (process.env.WATCHTOWER_API_URL || 'https://api.github.com').replace(/\/$/, '');
	const release = options.snapshot
		? (await readJson(options.snapshot)).releases?.find(item => item.tag_name === options.tag)
		: await requestJson(
			`${apiUrl}/repos/${policy.upstream.owner}/${policy.upstream.repository}/releases/tags/${encodeURIComponent(options.tag)}`,
		);
	if (!release || release.draft || release.prerelease || !release.published_at) {
		throw new Error(`${options.tag} is not a published stable release`);
	}

	process.stdout.write(`${JSON.stringify({
		upstreamTag: release.tag_name,
		syncBranch: `sync/joplin-${release.tag_name}`,
		sourceUrl: release.html_url,
		publishedAt: release.published_at,
	})}\n`);
};

const recordBaseline = async options => {
	if (!options.policy) throw new Error('--policy is required');
	if (!options.tag || !parseStableTag(options.tag)) {
		throw new Error(`Invalid stable tag: ${options.tag || '(missing)'}`);
	}
	if (!/^[0-9a-f]{40}$/i.test(options.sha || '')) {
		throw new Error(`Invalid commit SHA: ${options.sha || '(missing)'}`);
	}

	const policy = await readJson(options.policy);
	const currentVersion = parseStableTag(policy.upstream.baselineTag);
	const nextVersion = parseStableTag(options.tag);
	if (!currentVersion) throw new Error(`Invalid baseline tag: ${policy.upstream.baselineTag}`);
	if (compareVersions(nextVersion, currentVersion) <= 0) {
		throw new Error(`${options.tag} does not advance baseline ${policy.upstream.baselineTag}`);
	}

	policy.upstream.baselineTag = options.tag;
	policy.upstream.baselineCommit = options.sha.toLowerCase();
	await writeFile(options.policy, `${JSON.stringify(policy, null, 2)}\n`, 'utf8');
	process.stdout.write(`${options.policy}\n`);
};

const main = async () => {
	const { command, options } = parseArguments(process.argv.slice(2));
	if (command === 'monitor') {
		await monitor(options);
		return;
	}
	if (command === 'verify-release') {
		await verifyRelease(options);
		return;
	}
	if (command === 'record-baseline') {
		await recordBaseline(options);
		return;
	}
	throw new Error(`Unknown command: ${command || '(missing)'}`);
};

main().catch(error => {
	process.stderr.write(`${error.message}\n`);
	process.exitCode = 1;
});
