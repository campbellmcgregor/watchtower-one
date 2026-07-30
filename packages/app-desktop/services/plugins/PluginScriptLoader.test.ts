import {
	EphemeralPluginScriptLoader,
	FileBackedPluginScriptLoader,
} from './PluginScriptLoader';

// cspell:ignore Ctmp Fplugin

describe('EphemeralPluginScriptLoader', () => {
	test('delivers plugin source only after its isolated host page is ready', async () => {
		const events: string[] = [];
		let receivedPayload: unknown;
		const target = {
			loadURL: async (url: string) => {
				events.push(`page-loaded:${url}`);
			},
			webContents: {
				send: (channel: string, payload: unknown) => {
					events.push(`source-sent:${channel}`);
					receivedPayload = payload;
				},
			},
		};

		await new EphemeralPluginScriptLoader().load({
			pageUrl: 'file:///Watchtower/plugin_index.html?pluginId=watchtower.example',
			pluginId: 'watchtower.example',
			scriptText: 'joplin.plugins.register({ onStart: async () => {} });',
			target,
		});

		expect(events).toEqual([
			'page-loaded:file:///Watchtower/plugin_index.html?pluginId=watchtower.example&pluginScript=memory',
			'source-sent:pluginScriptSource',
		]);
		expect(receivedPayload).toEqual({
			pluginId: 'watchtower.example',
			scriptText: 'joplin.plugins.register({ onStart: async () => {} });',
		});
	});

	test('stock callers retain file-backed plugin script loading', async () => {
		const events: string[] = [];
		const loader = new FileBackedPluginScriptLoader(
			{
				writeFile: async (path, content, encoding) => {
					events.push(`written:${path}:${content}:${encoding}`);
				},
			},
			() => 'C:\\JoplinProfile\\tmp',
		);

		await loader.load({
			pageUrl: 'file:///Joplin/plugin_index.html?pluginId=example.stock',
			pluginId: 'example.stock',
			scriptText: 'stockPlugin();',
			target: {
				loadURL: async url => {
					events.push(`page-loaded:${url}`);
				},
				webContents: {
					send: () => {
						throw new Error('Stock plugin source must load from its file');
					},
				},
			},
		});

		expect(events).toEqual([
			'written:C:\\JoplinProfile\\tmp/plugin_example.stock.js:stockPlugin();:utf8',
			'page-loaded:file:///Joplin/plugin_index.html?pluginId=example.stock&pluginScript=file%3A%2F%2FC%3A%5CJoplinProfile%5Ctmp%2Fplugin_example.stock.js',
		]);
	});
});
