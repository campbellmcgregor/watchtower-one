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
		'**/services/plugins/PluginRunner.test.ts',
		'**/services/plugins/PluginScriptLoader.test.ts',
		'**/watchtower/desktop/makeEncryptedDesktopDependencies.test.ts',
		'**/watchtower/profile/SqlCipherEncryptedProfileConnection.integration.test.ts',
		'**/watchtower/renderer/startEncryptedJoplinRenderer.test.ts',
	],
	transform: {
		'\\.(ts|tsx)$': 'ts-jest',
	},
};
