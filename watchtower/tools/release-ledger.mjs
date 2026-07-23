import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const executeFile = promisify(execFile);

const parseArguments = arguments_ => {
	const [command, ...tokens] = arguments_;
	const options = { artifact: [] };

	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (!token?.startsWith('--')) throw new Error(`Invalid argument near ${token || '(end)'}`);
		const name = token.slice(2);
		if (name === 'allow-no-artifacts') {
			options[name] = true;
			continue;
		}

		const value = tokens[index + 1];
		if (!value || value.startsWith('--')) throw new Error(`Missing value for --${name}`);
		if (name === 'artifact') options.artifact.push(value);
		else options[name] = value;
		index += 1;
	}

	return { command, options };
};

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

const generate = async options => {
	const repository = resolve(requireOption(options, 'repository'));
	const upstreamTag = requireOption(options, 'upstream-tag');
	const expectedUpstreamSha = requireOption(options, 'upstream-sha');
	const revisionName = requireOption(options, 'revision');
	const lockfile = repositoryPath(repository, requireOption(options, 'lockfile'), 'lockfile');
	const output = repositoryPath(repository, requireOption(options, 'output'), 'output');
	if (!options.artifact.length && !options['allow-no-artifacts']) {
		throw new Error('At least one --artifact is required');
	}

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

	const artifacts = options.artifact
		.map(path => repositoryPath(repository, path, 'artifact'))
		.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
	const artifactRecords = await Promise.all(artifacts.map(async artifact => ({
		path: artifact.relativePath,
		sha256: await hashFile(artifact.absolutePath),
	})));
	const ledger = {
		schemaVersion: 1,
		upstream: {
			repository: options['upstream-repository'] || 'https://github.com/laurent22/joplin.git',
			tag: upstreamTag,
			commit: upstreamSha,
		},
		downstream: {
			revision,
			commits: await downstreamCommits(repository, upstreamSha, revision),
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
	const { command, options } = parseArguments(process.argv.slice(2));
	if (command !== 'generate') throw new Error(`Unknown command: ${command || '(missing)'}`);
	await generate(options);
};

main().catch(error => {
	process.stderr.write(`${error.message}\n`);
	process.exitCode = 1;
});
