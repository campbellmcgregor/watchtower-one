import { StartOptions } from '@joplin/lib/BaseApplication';
import { ProfileStorageBinding } from '@joplin/lib/profileStorageBinding';

export interface EncryptedRendererBridge {
	processArgv(): string[];
	profileStorage(): ProfileStorageBinding|undefined;
}

export interface EncryptedRendererApplication<TResult> {
	start(argv: string[], options: StartOptions): Promise<TResult>;
}

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

	return application.start(bridge.processArgv(), { profileStorage });
};
