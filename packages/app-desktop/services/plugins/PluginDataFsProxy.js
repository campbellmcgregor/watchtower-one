'use strict';

const normalizedVirtualPath = (path) => {
	if (typeof path !== 'string') throw new Error('Encrypted plugin data path must be a string');
	return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
};

const encodingFromOptions = (options) => {
	if (typeof options === 'string') return options;
	return options?.encoding;
};

const createPluginDataFsProxy = (dataDirectory, invoke) => {
	const root = normalizedVirtualPath(dataDirectory);
	const relativePath = (path) => {
		const normalized = normalizedVirtualPath(path);
		if (normalized === root) return '';
		if (!normalized.startsWith(`${root}/`)) {
			throw new Error('Plugin path is outside its encrypted data directory');
		}
		const relative = normalized.slice(root.length + 1);
		if (!relative || relative.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
			throw new Error('Encrypted plugin data path is invalid');
		}
		return relative;
	};
	const readFile = async (path, options) => {
		const result = await invoke({
			operation: 'readFile',
			path: relativePath(path),
		});
		const content = Buffer.from(result.contentBase64, 'base64');
		const encoding = encodingFromOptions(options);
		return encoding ? content.toString(encoding) : content;
	};
	const writeFile = async (path, value, options) => {
		const encoding = encodingFromOptions(options);
		const content = Buffer.isBuffer(value) ? value : Buffer.from(value, encoding);
		await invoke({
			operation: 'writeFile',
			path: relativePath(path),
			contentBase64: content.toString('base64'),
		});
	};
	const stat = async path => {
		const metadata = await invoke({ operation: 'stat', path: relativePath(path) });
		return {
			size: metadata.size,
			isDirectory: () => metadata.kind === 'directory',
			isFile: () => metadata.kind === 'file',
		};
	};

	return {
		ensureDir: async path => invoke({ operation: 'ensureDir', path: relativePath(path) }),
		outputFile: async (path, value, options) => {
			const encoding = encodingFromOptions(options);
			const content = Buffer.isBuffer(value) ? value : Buffer.from(value, encoding);
			await invoke({
				operation: 'outputFile',
				path: relativePath(path),
				contentBase64: content.toString('base64'),
			});
		},
		pathExists: async path => invoke({ operation: 'pathExists', path: relativePath(path) }),
		readFile,
		readJson: async path => JSON.parse(await readFile(path, 'utf8')),
		readdir: async path => invoke({ operation: 'readdir', path: relativePath(path) }),
		remove: async path => invoke({ operation: 'remove', path: relativePath(path) }),
		stat,
		writeFile,
		writeJson: (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8'),
	};
};

module.exports = createPluginDataFsProxy;
