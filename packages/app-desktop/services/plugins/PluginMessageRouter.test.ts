import pluginMessageRecipient from './PluginMessageRouter';

describe('pluginMessageRecipient', () => {
	test('binds a plugin message identity to its registered Electron sender', () => {
		const main = { id: 'main' };
		const pluginA = { id: 'plugin-a' };
		const pluginB = { id: 'plugin-b' };
		const context = {
			mainWindow: { webContents: main },
			pluginWindows: {
				'watchtower.a': { webContents: pluginA },
				'watchtower.b': { webContents: pluginB },
			},
		};

		expect(pluginMessageRecipient(pluginA, {
			target: 'mainWindow',
			pluginId: 'watchtower.a',
		}, context)).toBe(main);
		expect(pluginMessageRecipient(pluginA, {
			target: 'mainWindow',
			pluginId: 'watchtower.b',
		}, context)).toBeUndefined();
		expect(pluginMessageRecipient(main, {
			target: 'plugin',
			pluginId: 'watchtower.b',
		}, context)).toBe(pluginB);
		expect(pluginMessageRecipient(pluginA, {
			target: 'plugin',
			pluginId: 'watchtower.b',
		}, context)).toBeUndefined();
	});
});
