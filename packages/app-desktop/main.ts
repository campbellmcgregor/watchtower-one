import { app } from 'electron';
import { mkdirSync } from 'fs';
import { join, resolve } from 'path';
import {
	makeEncryptedDesktopDependencies,
} from './watchtower/desktop/makeEncryptedDesktopDependencies';
import runWatchtowerElectronMain from './watchtower/desktop/runWatchtowerElectronMain';
import retireEncryptedDesktopVault from './watchtower/desktop/retireEncryptedDesktopVault';
import {
	makeElectronSessionFactory,
} from './watchtower/profile/ephemeralProfileRuntimeTypes';
import createElectronPreProfileUnlockView from './watchtower/unlock/ElectronPreProfileUnlockView';
import registerCustomProtocols from './utils/customProtocols/registerCustomProtocols';

const testDataRoot = () => {
	if (!process.argv.includes('--running-tests')) return undefined;
	const index = process.argv.indexOf('--watchtower-data-root');
	if (index < 0 || index >= process.argv.length - 1) return undefined;
	return resolve(process.argv[index + 1]);
};

const registerProfileCloseHandler = (closeProfile: ()=> Promise<void>) => {
	let closeCompleted = false;
	let closeStarted = false;
	const closeAndQuit = async () => {
		try {
			await closeProfile();
			closeCompleted = true;
			app.quit();
		} catch (error) {
			console.error('Watchtower profile close failed:', error);
			app.exit(1);
		}
	};
	app.on('before-quit', event => {
		if (closeCompleted) return;
		event.preventDefault();
		if (closeStarted) return;
		closeStarted = true;
		void closeAndQuit();
	});
};

// Destroying the pre-profile window must not let Electron choose a successful
// default exit before the encrypted bootstrap has reported its result.
const keepAliveDuringPreProfileBootstrap = () => {};
app.on('window-all-closed', keepAliveDuringPreProfileBootstrap);

void runWatchtowerElectronMain({
	host: {
		prepareBeforeReady: registerCustomProtocols,
		registerProfileCloseHandler,
		applicationDataDirectory: () => testDataRoot() ?? app.getPath('appData'),
		ensureDirectory: path => mkdirSync(path, {
			mode: 0o700,
			recursive: true,
		}),
		setUserDataDirectory: path => app.setPath('userData', path),
		waitUntilReady: async () => app.whenReady(),
		createUnlockView: createElectronPreProfileUnlockView,
		quit: exitCode => {
			app.exit(exitCode);
		},
	},
	unlockAssetDirectory: join(__dirname, 'watchtower', 'unlock'),
	ephemeralSessionFactory: makeElectronSessionFactory(),
	makeEncryptedDesktopDependencies,
	retireEncryptedDesktopVault,
}).catch(error => {
	// The composition root already requested a failed-closed quit. Stderr is
	// retained for packaged diagnostics without creating a profile log file.
	console.error('Watchtower bootstrap failed closed:', error);
}).finally(() => {
	app.removeListener('window-all-closed', keepAliveDuringPreProfileBootstrap);
});
