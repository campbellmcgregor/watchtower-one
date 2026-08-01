'use strict';

const assertPluginModuleAvailable = (modulePath, pluginDataMode) => {
	if (pluginDataMode === 'encrypted' && modulePath === 'sqlite3') {
		throw new Error('Native plugin SQLite is unavailable with encrypted plugin storage');
	}
};

module.exports = assertPluginModuleAvailable;
