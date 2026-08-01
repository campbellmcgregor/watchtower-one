const path = require('path');
const baseConfig = require('../../../../jest.config.base.js');

module.exports = {
	...baseConfig,
	rootDir: path.resolve(__dirname, '../..'),
	setupFilesAfterEnv: [
		path.resolve(__dirname, 'jest.profile-proof.setup.js'),
	],
	testEnvironment: 'node',
	testMatch: [
		'**/services/plugins/EncryptedPluginDataFileSystem.test.ts',
		'**/services/plugins/PluginDataFsProxy.test.ts',
		'**/services/plugins/PluginMessageRouter.test.ts',
		'**/services/plugins/PluginModulePolicy.test.ts',
		'**/services/plugins/PluginRunner.test.ts',
		'**/services/plugins/PluginScriptLoader.test.ts',
		'**/watchtower/desktop/makeEncryptedDesktopDependencies.test.ts',
		'**/watchtower/desktop/runWatchtowerElectronMain.test.ts',
		'**/watchtower/profile/SqlCipherEncryptedProfileConnection.integration.test.ts',
		'**/watchtower/renderer/startEncryptedJoplinRenderer.test.ts',
	],
	transform: {
		'\\.(ts|tsx)$': 'ts-jest',
	},
};
