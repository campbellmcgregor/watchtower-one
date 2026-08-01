// eslint-disable-next-line @typescript-eslint/no-var-requires -- Runtime module is loaded by the plain-JavaScript plugin host.
const assertPluginModuleAvailable = require('./PluginModulePolicy.js');

describe('PluginModulePolicy', () => {
	test('fails closed for native SQLite only when encrypted plugin storage is active', () => {
		expect(() => assertPluginModuleAvailable('sqlite3', 'encrypted')).toThrow(
			'Native plugin SQLite is unavailable with encrypted plugin storage',
		);
		expect(() => assertPluginModuleAvailable('sqlite3', 'stock')).not.toThrow();
		expect(() => assertPluginModuleAvailable('fs-extra', 'encrypted')).not.toThrow();
	});
});
