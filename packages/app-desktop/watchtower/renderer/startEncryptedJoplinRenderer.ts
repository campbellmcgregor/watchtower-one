import { StartOptions } from '@joplin/lib/BaseApplication';
import { ProfileStorageBinding } from '@joplin/lib/profileStorageBinding';

export interface EncryptedRendererBridge {
	processArgv(): string[];
	profileStorage(): ProfileStorageBinding|undefined;
}

export interface EncryptedRendererApplication<TResult> {
	start(argv: string[], options: StartOptions): Promise<TResult>;
}

export const profileApplicationArgv = (argv: string[]) => {
	if (!argv.includes('--running-tests')) return argv;
	const filtered: string[] = [];
	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index];
		if (argument === '--watchtower-data-root') {
			index++;
			continue;
		}
		if (argument.startsWith('--inspect=')) continue;
		filtered.push(argument);
	}
	return filtered;
};

export const requireEncryptedProfileStorage = (
	profileStorage: ProfileStorageBinding|undefined,
): ProfileStorageBinding => {
	if (!profileStorage) {
		throw new Error('Encrypted profile storage is unavailable');
	}
	return profileStorage;
};

export const startEncryptedJoplinRenderer = async <TResult>(
	bridge: EncryptedRendererBridge,
	application: EncryptedRendererApplication<TResult>,
): Promise<TResult> => {
	const profileStorage = requireEncryptedProfileStorage(bridge.profileStorage());

	return application.start(profileApplicationArgv(bridge.processArgv()), { profileStorage });
};
