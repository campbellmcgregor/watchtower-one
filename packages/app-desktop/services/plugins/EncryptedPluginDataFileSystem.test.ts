import type { ProfilePrivateData } from '@joplin/lib/profileStorageBinding';
import EncryptedPluginDataFileSystem from './EncryptedPluginDataFileSystem';

const makePrivateData = (): ProfilePrivateData => {
	const content = new Map<string, Buffer>();
	const address = (scope: string, key: string) => `${scope}:${key}`;
	return {
		write: async (scope, key, value) => {
			content.set(address(scope, key), Buffer.from(value));
		},
		read: async (scope, key) => content.get(address(scope, key)),
		list: async scope => [...content.keys()]
			.filter(key => key.startsWith(`${scope}:`))
			.map(key => key.slice(scope.length + 1))
			.sort(),
		remove: async (scope, key) => {
			content.delete(address(scope, key));
		},
	};
};

describe('EncryptedPluginDataFileSystem', () => {
	test('a plugin can manage persistent files without receiving an operating-system path', async () => {
		const fileSystem = new EncryptedPluginDataFileSystem(makePrivateData());
		const pluginId = 'watchtower.example';

		expect(fileSystem.dataDirectory(pluginId)).toBe(
			'/watchtower-plugin-data/watchtower.example',
		);
		await fileSystem.execute(pluginId, {
			operation: 'ensureDir',
			path: 'indexes/search',
		});
		await fileSystem.execute(pluginId, {
			operation: 'writeFile',
			path: 'indexes/search/state.json',
			contentBase64: Buffer.from('encrypted-plugin-state').toString('base64'),
		});
		await expect(fileSystem.execute(pluginId, {
			operation: 'readFile',
			path: 'indexes/search/state.json',
		})).resolves.toEqual({
			contentBase64: Buffer.from('encrypted-plugin-state').toString('base64'),
		});
		await expect(fileSystem.execute(pluginId, {
			operation: 'readdir',
			path: 'indexes',
		})).resolves.toEqual(['search']);
		await expect(fileSystem.execute(pluginId, {
			operation: 'pathExists',
			path: 'indexes/search',
		})).resolves.toBe(true);

		await fileSystem.execute(pluginId, {
			operation: 'remove',
			path: 'indexes',
		});
		await expect(fileSystem.execute(pluginId, {
			operation: 'pathExists',
			path: 'indexes/search/state.json',
		})).resolves.toBe(false);
	});

	test('encrypted empty directories and file metadata preserve fs-extra behavior', async () => {
		const fileSystem = new EncryptedPluginDataFileSystem(makePrivateData());
		const pluginId = 'watchtower.example';

		await fileSystem.execute(pluginId, {
			operation: 'ensureDir',
			path: 'exports/reports',
		});
		await expect(fileSystem.execute(pluginId, {
			operation: 'pathExists',
			path: 'exports/reports',
		})).resolves.toBe(true);
		await expect(fileSystem.execute(pluginId, {
			operation: 'stat',
			path: 'exports/reports',
		})).resolves.toEqual({ kind: 'directory', size: 0 });

		await fileSystem.execute(pluginId, {
			operation: 'writeFile',
			path: 'exports/reports/latest.json',
			contentBase64: Buffer.from('{"complete":true}').toString('base64'),
		});
		await expect(fileSystem.execute(pluginId, {
			operation: 'stat',
			path: 'exports/reports/latest.json',
		})).resolves.toEqual({ kind: 'file', size: 17 });
		await expect(fileSystem.execute(pluginId, {
			operation: 'readdir',
			path: 'exports',
		})).resolves.toEqual(['reports']);
	});

	test('preserves write, output, and directory error semantics', async () => {
		const fileSystem = new EncryptedPluginDataFileSystem(makePrivateData());
		const pluginId = 'watchtower.example';
		const contentBase64 = Buffer.from('state').toString('base64');

		await expect(fileSystem.execute(pluginId, {
			operation: 'writeFile',
			path: 'missing/state.json',
			contentBase64,
		})).rejects.toThrow('directory does not exist');

		await fileSystem.execute(pluginId, {
			operation: 'outputFile',
			path: 'created/state.json',
			contentBase64,
		});
		await expect(fileSystem.execute(pluginId, {
			operation: 'readdir',
			path: 'created',
		})).resolves.toEqual(['state.json']);
		await expect(fileSystem.execute(pluginId, {
			operation: 'ensureDir',
			path: 'created/state.json',
		})).rejects.toThrow('path is a file');
		await expect(fileSystem.execute(pluginId, {
			operation: 'readdir',
			path: 'missing',
		})).rejects.toThrow('directory does not exist');
		await expect(fileSystem.execute(pluginId, {
			operation: 'readdir',
			path: 'created/state.json',
		})).rejects.toThrow('path is a file');
	});
});
