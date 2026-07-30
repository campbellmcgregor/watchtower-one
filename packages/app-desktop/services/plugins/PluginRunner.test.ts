import { EventEmitter } from 'events';
import type Plugin from '@joplin/lib/services/plugins/Plugin';
import type Global from '@joplin/lib/services/plugins/api/Global';
import type { PluginScriptLoader } from './PluginScriptLoader';

const mockIpcRenderer = new EventEmitter();
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
});
