import type {
	ProfilePrivateData,
	ProfilePrivateDataScope,
} from '@joplin/lib/profileStorageBinding';

export type EncryptedPluginDataRequest =
	{ operation: 'ensureDir'; path: string }|
	{ operation: 'outputFile'; path: string; contentBase64: string }|
	{ operation: 'pathExists'; path: string }|
	{ operation: 'readFile'; path: string }|
	{ operation: 'readdir'; path: string }|
	{ operation: 'remove'; path: string }|
	{ operation: 'stat'; path: string }|
	{ operation: 'writeFile'; path: string; contentBase64: string };

export interface EncryptedPluginDataFileContent {
	contentBase64: string;
}

export interface EncryptedPluginDataMetadata {
	kind: 'directory'|'file';
	size: number;
}

const maximumPluginDataFileBytes = 100 * 1024 * 1024;
const directoryMarkerRoot = '.__watchtower_directories__';

const validatePluginId = (pluginId: string) => {
	if (!/^[A-Za-z0-9._-]+$/.test(pluginId)) {
		throw new Error('Encrypted plugin data identity is invalid');
	}
};

const normalizedRelativePath = (path: string, allowRoot = true) => {
	if (typeof path !== 'string' || path.includes('\\')) {
		throw new Error('Encrypted plugin data path is invalid');
	}
	const segments = path.split('/');
	if (allowRoot && path === '') return '';
	if (
		path.length > 1024 ||
		segments[0] === directoryMarkerRoot ||
		segments.some(segment => !segment || segment === '.' || segment === '..')
	) {
		throw new Error('Encrypted plugin data path is invalid');
	}
	return segments.join('/');
};

export default class EncryptedPluginDataFileSystem {

	public constructor(private readonly privateData_: ProfilePrivateData) {}

	public dataDirectory(pluginId: string) {
		validatePluginId(pluginId);
		return `/watchtower-plugin-data/${pluginId}`;
	}

	public async execute(
		pluginId: string,
		request: EncryptedPluginDataRequest,
	): Promise<boolean|string[]|EncryptedPluginDataFileContent|EncryptedPluginDataMetadata|undefined> {
		validatePluginId(pluginId);
		const scope: ProfilePrivateDataScope = `plugin:${pluginId}`;
		const path = normalizedRelativePath(
			request.path,
			request.operation !== 'readFile' && request.operation !== 'writeFile',
		);
		const allKeys = async () => this.privateData_.list(scope);
		const fileKeys = async () => (await allKeys()).filter(
			key => !key.startsWith(`${directoryMarkerRoot}/`),
		);
		const directoryPaths = async () => (await allKeys())
			.filter(key => key.startsWith(`${directoryMarkerRoot}/`))
			.map(key => key.slice(directoryMarkerRoot.length + 1));
		const pathIsDirectory = async (candidatePath = path) => {
			if (!candidatePath) return true;
			const prefix = `${candidatePath}/`;
			return (await directoryPaths()).some(directory => (
				directory === candidatePath || directory.startsWith(prefix)
			)) || (await fileKeys()).some(key => key.startsWith(prefix));
		};
		const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
		const assertNoFileAncestor = async () => {
			const files = await fileKeys();
			const segments = path.split('/');
			for (let index = 1; index < segments.length; index++) {
				if (files.includes(segments.slice(0, index).join('/'))) {
					throw new Error(`Encrypted plugin data parent is a file: ${path}`);
				}
			}
		};
		const writeFile = async (contentBase64: string, createParent: boolean) => {
			if (await pathIsDirectory()) {
				throw new Error(`Encrypted plugin data path is a directory: ${path}`);
			}
			await assertNoFileAncestor();
			if (!createParent && !await pathIsDirectory(parentPath)) {
				throw new Error(`Encrypted plugin data directory does not exist: ${parentPath}`);
			}
			const content = Buffer.from(contentBase64, 'base64');
			if (content.byteLength > maximumPluginDataFileBytes) {
				throw new Error('Encrypted plugin data file is too large');
			}
			if (createParent && parentPath) {
				await this.privateData_.write(
					scope,
					`${directoryMarkerRoot}/${parentPath}`,
					Buffer.alloc(0),
				);
			}
			await this.privateData_.write(scope, path, content);
		};

		switch (request.operation) {
		case 'writeFile':
			await writeFile(request.contentBase64, false);
			return undefined;
		case 'outputFile':
			await writeFile(request.contentBase64, true);
			return undefined;
		case 'readFile': {
			const content = await this.privateData_.read(scope, path);
			if (!content) throw new Error(`Encrypted plugin data file does not exist: ${path}`);
			return { contentBase64: Buffer.from(content).toString('base64') };
		}
		case 'ensureDir':
			if (path) {
				if ((await fileKeys()).includes(path)) {
					throw new Error(`Encrypted plugin data path is a file: ${path}`);
				}
				await assertNoFileAncestor();
				await this.privateData_.write(
					scope,
					`${directoryMarkerRoot}/${path}`,
					Buffer.alloc(0),
				);
			}
			return undefined;
		case 'pathExists': {
			return (await fileKeys()).includes(path) || await pathIsDirectory();
		}
		case 'readdir': {
			if ((await fileKeys()).includes(path)) {
				throw new Error(`Encrypted plugin data path is a file: ${path}`);
			}
			if (!await pathIsDirectory()) {
				throw new Error(`Encrypted plugin data directory does not exist: ${path}`);
			}
			const prefix = path ? `${path}/` : '';
			const entries = [...await fileKeys(), ...await directoryPaths()]
				.filter(key => key.startsWith(prefix))
				.map(key => key.slice(prefix.length).split('/')[0]);
			return [...new Set(entries)].sort();
		}
		case 'stat': {
			const content = path ? await this.privateData_.read(scope, path) : undefined;
			if (content) return { kind: 'file', size: content.byteLength };
			if (await pathIsDirectory()) return { kind: 'directory', size: 0 };
			throw new Error(`Encrypted plugin data path does not exist: ${path}`);
		}
		case 'remove': {
			const keys = await allKeys();
			const prefix = path ? `${path}/` : '';
			const markerPath = path ? `${directoryMarkerRoot}/${path}` : directoryMarkerRoot;
			const markerPrefix = `${markerPath}/`;
			const matchingKeys = keys.filter(key => (
				!path ||
				key === path ||
				key.startsWith(prefix) ||
				key === markerPath ||
				key.startsWith(markerPrefix)
			));
			await Promise.all(matchingKeys.map(key => this.privateData_.remove(scope, key)));
			return undefined;
		}
		}
	}
}
