import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { lstat, opendir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import parseArguments from './cli-arguments.mjs';

const executeFile = promisify(execFile);

const requireOption = (options, name) => {
	if (!options[name]) throw new Error(`--${name} is required`);
	return options[name];
};

const repositoryPath = (repository, path, name) => {
	const absolutePath = resolve(repository, path);
	const relativePath = relative(repository, absolutePath);
	if (
		relativePath === '..'
		|| relativePath.startsWith(`..${sep}`)
		|| isAbsolute(relativePath)
	) throw new Error(`${name} must be inside the repository: ${path}`);

	return {
		absolutePath,
		relativePath: relativePath.split(sep).join('/'),
	};
};

const git = async (repository, arguments_) => {
	const { stdout } = await executeFile('git', arguments_, {
		cwd: repository,
		encoding: 'utf8',
		maxBuffer: 16 * 1024 * 1024,
	});
	return stdout.trim();
};

const hashFile = path => new Promise((resolveHash, reject) => {
	const hash = createHash('sha256');
	const stream = createReadStream(path);
	stream.on('error', reject);
	stream.on('data', chunk => hash.update(chunk));
	stream.on('end', () => resolveHash(hash.digest('hex')));
});

const artifactFiles = async (repository, artifactPaths, directoryPaths) => {
	const files = new Map();

	const addFile = async (path, name) => {
		const artifact = repositoryPath(repository, path, name);
		const stats = await lstat(artifact.absolutePath);
		if (!stats.isFile() || stats.isSymbolicLink()) {
			throw new Error(`${name} must be a regular file: ${path}`);
		}
		files.set(artifact.relativePath, artifact);
	};
	const visitDirectory = async directory => {
		const entries = await opendir(directory.absolutePath);
		for await (const entry of entries) {
			const child = repositoryPath(
				repository,
				resolve(directory.absolutePath, entry.name),
				'artifact directory entry',
			);
			if (entry.isDirectory()) await visitDirectory(child);
			else if (entry.isFile()) files.set(child.relativePath, child);
			else throw new Error(`Artifact directory contains a non-regular file: ${child.relativePath}`);
		}
	};

	for (const path of artifactPaths) await addFile(path, 'artifact');
	for (const path of directoryPaths) {
		const directory = repositoryPath(repository, path, 'artifact directory');
		const stats = await lstat(directory.absolutePath);
		if (!stats.isDirectory() || stats.isSymbolicLink()) {
			throw new Error(`artifact directory must be a directory: ${path}`);
		}
		await visitDirectory(directory);
	}

	return [...files.values()].sort((left, right) => (
		left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0
	));
};

const downstreamCommits = async (repository, upstreamSha, revision) => {
	const output = await git(repository, [
		'log',
		'--reverse',
		'--format=%H%x00%s',
		`${upstreamSha}..${revision}`,
	]);
	if (!output) return [];

	return output.split('\n').map(line => {
		const separator = line.indexOf('\0');
		if (separator < 0) throw new Error('Unexpected git log output');
		return {
			commit: line.slice(0, separator),
			subject: line.slice(separator + 1),
		};
	});
};

const readPatchRegistry = async (path, downstream) => {
	const registry = JSON.parse(await readFile(path, 'utf8'));
	if (registry.schemaVersion !== 1 || !Array.isArray(registry.patches)) {
		throw new Error('Patch registry must use schemaVersion 1 and contain a patches array');
	}

	const downstreamShas = new Set(downstream.map(commit => commit.commit));
	const identifiers = new Set();
	for (const patch of registry.patches) {
		if (
			typeof patch.id !== 'string'
			|| !patch.id
			|| typeof patch.owner !== 'string'
			|| !patch.owner
			|| !Array.isArray(patch.commits)
			|| !patch.commits.length
			|| !Array.isArray(patch.upstreamTouchpoints)
			|| !patch.upstreamTouchpoints.length
			|| !Array.isArray(patch.tests)
			|| !patch.tests.length
			|| typeof patch.upstreamCandidate !== 'boolean'
		) throw new Error(`Invalid patch registry entry: ${patch.id || '(missing id)'}`);
		if (identifiers.has(patch.id)) throw new Error(`Duplicate patch id: ${patch.id}`);
		identifiers.add(patch.id);
		for (const commit of patch.commits) {
			if (!downstreamShas.has(commit)) {
				throw new Error(`Patch ${patch.id} references commit outside the downstream set: ${commit}`);
			}
		}
	}

	return [...registry.patches].sort((left, right) => (
		left.id < right.id ? -1 : left.id > right.id ? 1 : 0
	));
};

const generate = async options => {
	const repository = resolve(requireOption(options, 'repository'));
	const upstreamTag = requireOption(options, 'upstream-tag');
	const expectedUpstreamSha = requireOption(options, 'upstream-sha');
	const revisionName = requireOption(options, 'revision');
	const lockfile = repositoryPath(repository, requireOption(options, 'lockfile'), 'lockfile');
	const patchRegistry = repositoryPath(
		repository,
		requireOption(options, 'patch-registry'),
		'patch registry',
	);
	const output = repositoryPath(repository, requireOption(options, 'output'), 'output');

	const upstreamSha = await git(repository, ['rev-parse', '--verify', `${upstreamTag}^{commit}`]);
	if (upstreamSha !== expectedUpstreamSha) {
		throw new Error(`Tag ${upstreamTag} resolves to ${upstreamSha}, not ${expectedUpstreamSha}`);
	}
	const revision = await git(repository, ['rev-parse', '--verify', `${revisionName}^{commit}`]);
	try {
		await executeFile('git', ['merge-base', '--is-ancestor', upstreamSha, revision], { cwd: repository });
	} catch {
		throw new Error(`${upstreamSha} is not an ancestor of ${revision}`);
	}

	const artifacts = await artifactFiles(
		repository,
		options.artifact,
		options['artifact-directory'],
	);
	if (!artifacts.length && !options['allow-no-artifacts']) {
		throw new Error('At least one --artifact or non-empty --artifact-directory is required');
	}
	const artifactRecords = await Promise.all(artifacts.map(async artifact => ({
		path: artifact.relativePath,
		sha256: await hashFile(artifact.absolutePath),
	})));
	const commits = await downstreamCommits(repository, upstreamSha, revision);
	const ledger = {
		schemaVersion: 1,
		upstream: {
			repository: options['upstream-repository'] || 'https://github.com/laurent22/joplin.git',
			tag: upstreamTag,
			commit: upstreamSha,
		},
		downstream: {
			revision,
			commits,
			patches: await readPatchRegistry(patchRegistry.absolutePath, commits),
		},
		lockfile: {
			path: lockfile.relativePath,
			sha256: await hashFile(lockfile.absolutePath),
		},
		artifacts: artifactRecords,
	};

	await writeFile(output.absolutePath, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
	process.stdout.write(`${output.absolutePath}\n`);
};

const main = async () => {
	const { command, options } = parseArguments(process.argv.slice(2), {
		boolean: ['allow-no-artifacts'],
		repeatable: ['artifact', 'artifact-directory'],
	});
	if (command !== 'generate') throw new Error(`Unknown command: ${command || '(missing)'}`);
	await generate(options);
};

main().catch(error => {
	process.stderr.write(`${error.message}\n`);
	process.exitCode = 1;
});
