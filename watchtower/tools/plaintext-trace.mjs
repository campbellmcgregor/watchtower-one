import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, opendir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import parseArguments from './cli-arguments.mjs';

const requireOption = (options, name) => {
	if (!options[name]) throw new Error(`--${name} is required`);
	return options[name];
};

const namedValues = (values, optionName) => {
	const output = new Map();
	for (const value of values) {
		const separator = value.indexOf('=');
		const id = separator < 0 ? '' : value.slice(0, separator);
		const itemValue = separator < 0 ? '' : value.slice(separator + 1);
		if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id) || !itemValue) {
			throw new Error(`--${optionName} must use name=value: ${value}`);
		}
		if (output.has(id)) throw new Error(`Duplicate --${optionName} name: ${id}`);
		output.set(id, itemValue);
	}
	if (!output.size) throw new Error(`At least one --${optionName} is required`);
	return output;
};

const canaryPatterns = canaries => [...canaries].map(([id, value]) => ({
	id,
	patterns: [
		{ encoding: 'utf8', bytes: Buffer.from(value, 'utf8') },
		{ encoding: 'utf16le', bytes: Buffer.from(value, 'utf16le') },
	],
}));

const manifestPath = (root, path) => relative(root, path).split(sep).join('/');

const recordScanError = (errors, root, rootPath, path, error) => {
	errors.push({
		root,
		path: manifestPath(rootPath, path),
		error: error instanceof Error ? error.message : String(error),
	});
};

const scanFile = (path, patterns) => new Promise((resolveScan, reject) => {
	const hash = createHash('sha256');
	const matches = new Map();
	const maximumPatternLength = Math.max(
		...patterns.flatMap(canary => canary.patterns.map(pattern => pattern.bytes.length)),
	);
	let overlap = Buffer.alloc(0);
	const stream = createReadStream(path);

	stream.on('error', reject);
	stream.on('data', chunk => {
		hash.update(chunk);
		const searchable = overlap.length ? Buffer.concat([overlap, chunk]) : chunk;
		for (const canary of patterns) {
			for (const pattern of canary.patterns) {
				if (searchable.indexOf(pattern.bytes) >= 0) {
					if (!matches.has(canary.id)) matches.set(canary.id, new Set());
					matches.get(canary.id).add(pattern.encoding);
				}
			}
		}
		overlap = maximumPatternLength > 1
			? searchable.subarray(Math.max(0, searchable.length - maximumPatternLength + 1))
			: Buffer.alloc(0);
	});
	stream.on('end', () => resolveScan({
		sha256: hash.digest('hex'),
		canaries: [...matches].sort(([left], [right]) => left.localeCompare(right)).map(
			([id, encodings]) => ({ id, encodings: [...encodings].sort() }),
		),
	}));
});

const snapshotRoot = async (id, path, patterns, files, errors) => {
	const absoluteRoot = resolve(path);

	const visit = async absolutePath => {
		let stats;
		try {
			stats = await lstat(absolutePath);
		} catch (error) {
			recordScanError(errors, id, absoluteRoot, absolutePath, error);
			return;
		}

		if (stats.isSymbolicLink()) {
			recordScanError(
				errors,
				id,
				absoluteRoot,
				absolutePath,
				'Symbolic links and reparse points are not scanned',
			);
			return;
		}
		if (stats.isDirectory()) {
			const entries = [];
			try {
				const directory = await opendir(absolutePath);
				for await (const entry of directory) entries.push(entry.name);
			} catch (error) {
				recordScanError(errors, id, absoluteRoot, absolutePath, error);
				return;
			}
			entries.sort((left, right) => left.localeCompare(right));
			for (const entry of entries) await visit(resolve(absolutePath, entry));
			return;
		}
		if (!stats.isFile()) {
			recordScanError(
				errors,
				id,
				absoluteRoot,
				absolutePath,
				'Non-regular filesystem entry is not scanned',
			);
			return;
		}

		try {
			const scan = await scanFile(absolutePath, patterns);
			files.push({
				root: id,
				path: manifestPath(absoluteRoot, absolutePath),
				size: stats.size,
				...scan,
			});
		} catch (error) {
			recordScanError(errors, id, absoluteRoot, absolutePath, error);
		}
	};

	await visit(absoluteRoot);
	return { id, path: absoluteRoot.split(sep).join('/') };
};

const snapshot = async options => {
	const scenario = requireOption(options, 'scenario');
	const output = resolve(requireOption(options, 'output'));
	const roots = namedValues(options.root, 'root');
	const canaries = namedValues(options.canary, 'canary');
	const patterns = canaryPatterns(canaries);
	const files = [];
	const errors = [];
	const rootRecords = [];

	for (const [id, path] of roots) {
		rootRecords.push(await snapshotRoot(id, path, patterns, files, errors));
	}
	files.sort((left, right) => (
		left.root.localeCompare(right.root) || left.path.localeCompare(right.path)
	));
	errors.sort((left, right) => (
		left.root.localeCompare(right.root) || left.path.localeCompare(right.path)
	));

	const manifest = {
		schemaVersion: 1,
		scenario,
		capturedAt: new Date().toISOString(),
		roots: rootRecords.sort((left, right) => left.id.localeCompare(right.id)),
		canaryIds: [...canaries.keys()].sort(),
		files,
		errors,
	};
	await mkdir(dirname(output), { recursive: true });
	await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
	process.stdout.write(`${output}\n`);
};

const main = async () => {
	const { command, options } = parseArguments(process.argv.slice(2), {
		repeatable: ['root', 'canary'],
	});
	if (command !== 'snapshot') throw new Error(`Unknown command: ${command || '(missing)'}`);
	await snapshot(options);
};

main().catch(error => {
	process.stderr.write(`${error.message}\n`);
	process.exitCode = 1;
});
