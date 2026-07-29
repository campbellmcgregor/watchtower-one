import { app } from 'electron';
import { mkdirSync } from 'fs';
import { join } from 'path';
import {
	makeEncryptedDesktopDependencies,
} from './watchtower/desktop/makeEncryptedDesktopDependencies';
import runWatchtowerElectronMain from './watchtower/desktop/runWatchtowerElectronMain';
import {
	makeElectronSessionFactory,
} from './watchtower/profile/ephemeralProfileRuntimeTypes';
import createElectronPreProfileUnlockView from './watchtower/unlock/ElectronPreProfileUnlockView';

void runWatchtowerElectronMain({
	host: {
		applicationDataDirectory: () => app.getPath('appData'),
		ensureDirectory: path => mkdirSync(path, {
			mode: 0o700,
			recursive: true,
		}),
		setUserDataDirectory: path => app.setPath('userData', path),
		waitUntilReady: async () => app.whenReady(),
		createUnlockView: createElectronPreProfileUnlockView,
		quit: exitCode => {
			process.exitCode = exitCode;
			app.quit();
		},
	},
	unlockAssetDirectory: join(__dirname, 'watchtower', 'unlock'),
	ephemeralSessionFactory: makeElectronSessionFactory(),
	makeEncryptedDesktopDependencies,
}).catch(() => {
	// The composition root already requested a failed-closed quit.
});
