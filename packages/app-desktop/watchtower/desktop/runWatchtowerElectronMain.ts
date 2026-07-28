import { join } from 'path';
import type {
	EphemeralElectronSessionFactory,
} from '../profile/ephemeralProfileRuntimeTypes';
import type {
	JoplinProfileRuntime,
} from '../profile/joplinProfileTypes';
import type {
	EncryptedDesktopDependencyOptions,
} from './makeEncryptedDesktopDependencies';
import runPreProfileUnlockFlow from './runPreProfileUnlockFlow';
import type {
	PreProfileUnlockFlowResult,
	PreProfileUnlockView,
} from './runPreProfileUnlockFlow';
import {
	startWatchtowerDesktop,
} from './startWatchtowerDesktop';
import type {
	WatchtowerDesktopDependencies,
} from './startWatchtowerDesktop';

export interface WatchtowerElectronHost {
	applicationDataDirectory(): string;
	ensureDirectory(path: string): void;
	setUserDataDirectory(path: string): void;
	waitUntilReady(): Promise<void>;
	createUnlockView(assetDirectory: string): Promise<PreProfileUnlockView>;
	quit(exitCode: 0|1): void;
}

export interface WatchtowerElectronMainDependencies {
	host: WatchtowerElectronHost;
	unlockAssetDirectory: string;
	ephemeralSessionFactory: EphemeralElectronSessionFactory;
	makeEncryptedDesktopDependencies(
		options: EncryptedDesktopDependencyOptions,
	): WatchtowerDesktopDependencies;
}

const loadPendingEncryptedJoplinRuntime = async (): Promise<JoplinProfileRuntime> => {
	// Stock Joplin startup still creates profile-bearing settings, logs, window
	// state, and Electron session files. Keep that runtime unavailable until
	// those paths consume the encrypted/ephemeral profile binding.
	throw new Error('Encrypted Joplin runtime binding is unavailable');
};

const runWatchtowerElectronMain = async (
	dependencies: WatchtowerElectronMainDependencies,
): Promise<PreProfileUnlockFlowResult> => {
	try {
		const userDataDirectory = join(
			dependencies.host.applicationDataDirectory(),
			'Watchtower One',
		);
		dependencies.host.ensureDirectory(userDataDirectory);
		dependencies.host.setUserDataDirectory(userDataDirectory);
		await dependencies.host.waitUntilReady();
		const view = await dependencies.host.createUnlockView(
			dependencies.unlockAssetDirectory,
		);
		const vaultDirectory = join(userDataDirectory, 'vault');
		const result = await runPreProfileUnlockFlow(
			view,
			async (command, signal) => startWatchtowerDesktop(
				dependencies.makeEncryptedDesktopDependencies({
					command,
					databasePath: join(vaultDirectory, 'profile.sqlite'),
					envelopeDirectory: join(vaultDirectory, 'envelope'),
					loadJoplinProfileRuntime: loadPendingEncryptedJoplinRuntime,
					profileHostOptions: {
						ephemeralSessionFactory: dependencies.ephemeralSessionFactory,
						resourceDirectory: join(vaultDirectory, 'resource-virtual'),
					},
				}),
				signal,
			),
		);
		if (result.kind === 'cancelled') dependencies.host.quit(0);
		else if (result.kind !== 'unlocked') dependencies.host.quit(1);
		return result;
	} catch (error) {
		dependencies.host.quit(1);
		throw error;
	}
};

export default runWatchtowerElectronMain;
