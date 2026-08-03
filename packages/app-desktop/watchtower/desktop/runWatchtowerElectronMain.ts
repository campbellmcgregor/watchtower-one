import { join } from 'path';
import type {
	EphemeralElectronSessionFactory,
} from '../profile/ephemeralProfileRuntimeTypes';
import type {
	LoadJoplinProfileRuntime,
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
import {
	loadJoplinElectronProfileRuntime,
} from './JoplinElectronProfileRuntime';

export interface WatchtowerElectronHost {
	prepareBeforeReady(): void;
	registerProfileCloseHandler(closeProfile: ()=> Promise<void>): void;
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
	loadJoplinProfileRuntime?: LoadJoplinProfileRuntime;
	makeEncryptedDesktopDependencies(
		options: EncryptedDesktopDependencyOptions,
	): WatchtowerDesktopDependencies;
}

const runWatchtowerElectronMain = async (
	dependencies: WatchtowerElectronMainDependencies,
): Promise<PreProfileUnlockFlowResult> => {
	try {
		dependencies.host.prepareBeforeReady();
		const userDataDirectory = join(
			dependencies.host.applicationDataDirectory(),
			'Watchtower One',
		);
		const publicRuntimeDirectory = join(userDataDirectory, 'runtime');
		const publicVaultLockFilePath = join(publicRuntimeDirectory, 'vault.lock');
		const publicPluginCodeDirectory = join(userDataDirectory, 'code', 'plugins');
		dependencies.host.ensureDirectory(userDataDirectory);
		dependencies.host.ensureDirectory(publicRuntimeDirectory);
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
					loadJoplinProfileRuntime: dependencies.loadJoplinProfileRuntime ??
						loadJoplinElectronProfileRuntime,
					profileHostOptions: {
						ephemeralSessionFactory: dependencies.ephemeralSessionFactory,
						pluginCode: {
							cacheDirectory: join(publicPluginCodeDirectory, 'cache'),
							packageDirectory: join(publicPluginCodeDirectory, 'packages'),
						},
						publicVaultLockFilePath,
						resourceDirectory: join(vaultDirectory, 'resource-virtual'),
					},
				}),
				signal,
			),
		);
		if (result.kind === 'cancelled') { dependencies.host.quit(0); } else if (result.kind !== 'unlocked') { dependencies.host.quit(1); } else {
			dependencies.host.registerProfileCloseHandler(async () => {
				await result.lifecycle.end('close');
			});
		}
		return result;
	} catch (error) {
		dependencies.host.quit(1);
		throw error;
	}
};

export default runWatchtowerElectronMain;
