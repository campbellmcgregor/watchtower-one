const path = require('path');
const baseConfig = require('../../../../jest.config.base.js');

module.exports = {
	...baseConfig,
	rootDir: path.resolve(__dirname, '../..'),
	testEnvironment: 'jsdom',
	testMatch: [
		'**/watchtower/desktop/runWatchtowerElectronMain.test.ts',
		'**/watchtower/desktop/runPreProfileUnlockFlow.test.ts',
		'**/watchtower/desktop/startWatchtowerDesktop.test.ts',
		'**/watchtower/unlock/*.test.ts',
	],
	transform: {
		'\\.(ts|tsx)$': 'ts-jest',
	},
};
