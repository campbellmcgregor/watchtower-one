import { EventEmitter } from 'events';
import type Plugin from '@joplin/lib/services/plugins/Plugin';
import type Global from '@joplin/lib/services/plugins/api/Global';
import type { ProfilePrivateData } from '@joplin/lib/profileStorageBinding';
import type { PluginScriptLoader } from './PluginScriptLoader';
import EncryptedPluginDataFileSystem from './EncryptedPluginDataFileSystem';

const mockIpcRenderer = Object.assign(new EventEmitter(), {
	send: jest.fn(),
});
const mockPluginWebContents = Object.assign(new EventEmitter(), {
	openDevTools: jest.fn(),
	send: jest.fn(),
});
const mockPluginWindow = {
	loadURL: jest.fn(async () => {}),
	webContents: mockPluginWebContents,
};
const mockBridge = {
	newBrowserWindow: jest.fn(() => mockPluginWindow),
	electronApp: () => ({
		registerPluginWindow: jest.fn(),
	}),
};

jest.mock('electron', () => ({
	ipcRenderer: mockIpcRenderer,
}));
jest.mock('@electron/remote/main', () => ({
	enable: jest.fn(),
}));
jest.mock('../bridge', () => ({
	__esModule: true,
	default: () => mockBridge,
}));
jest.mock('../../utils/7zip/getPathToExecutable7Zip', () => ({
	__esModule: true,
	default: async () => 'C:\\Watchtower\\7za.exe',
}));
jest.mock('../../utils/getAssetPath', () => ({
	__esModule: true,
	default: () => 'C:\\Watchtower\\plugin_index.html',
}));

import PluginRunner from './PluginRunner';

describe('PluginRunner', () => {
	afterEach(() => {
		mockIpcRenderer.removeAllListeners();
		mockPluginWebContents.removeAllListeners();
		jest.clearAllMocks();
	});

	test('installs host listeners before plugin source can execute', async () => {
		const loader: PluginScriptLoader = {
			load: async () => {
				expect(mockIpcRenderer.listenerCount('pluginMessage')).toBe(1);
				expect(mockPluginWebContents.listenerCount('dom-ready')).toBe(1);
			},
		};
		const plugin = {
			devMode: true,
			id: 'watchtower.example',
			scriptText: 'joplin.plugins.register({ onStart: async () => {} });',
		} as Plugin;

		await new PluginRunner(loader).run(plugin, {} as Global);
	});

	test('binds virtual data-directory requests to the running plugin identity', async () => {
		const content = new Map<string, Buffer>();
		const privateData: ProfilePrivateData = {
			write: async (scope, key, value) => {
				content.set(`${scope}:${key}`, Buffer.from(value));
			},
			read: async (scope, key) => content.get(`${scope}:${key}`),
			list: async scope => [...content.keys()]
				.filter(key => key.startsWith(`${scope}:`))
				.map(key => key.slice(scope.length + 1)),
			remove: async (scope, key) => {
				content.delete(`${scope}:${key}`);
			},
		};
		const plugin = {
			devMode: false,
			id: 'watchtower.example',
			scriptText: 'joplin.plugins.register({ onStart: async () => {} });',
		} as Plugin;
		let pluginPageUrl = '';
		const runner = new PluginRunner(
			{ load: async options => {
				pluginPageUrl = options.pageUrl;
			} },
			new EncryptedPluginDataFileSystem(privateData),
		);
		await runner.run(plugin, {} as Global);
		expect(new URL(pluginPageUrl).searchParams.get('pluginData')).toBe('encrypted');

		mockIpcRenderer.emit('pluginMessage', {}, {
			target: 'mainWindow',
			pluginId: plugin.id,
			callbackId: 'data-directory',
			path: 'plugins.dataDir',
			args: [],
		});
		await new Promise(resolve => setTimeout(resolve, 0));
		expect(mockIpcRenderer.send).toHaveBeenCalledWith('pluginMessage', expect.objectContaining({
			pluginCallbackId: 'data-directory',
			result: '/watchtower-plugin-data/watchtower.example',
		}));

		mockIpcRenderer.emit('pluginMessage', {}, {
			target: 'mainWindow',
			pluginId: plugin.id,
			callbackId: 'write-file',
			path: '__watchtowerPluginDataFs__',
			args: [{
				operation: 'writeFile',
				path: 'state.json',
				contentBase64: Buffer.from('plugin-state').toString('base64'),
			}],
		});
		await new Promise(resolve => setTimeout(resolve, 0));
		expect(content.get('plugin:watchtower.example:state.json')).toEqual(
			Buffer.from('plugin-state'),
		);
	});
});
