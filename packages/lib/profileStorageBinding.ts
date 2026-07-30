import FsDriverBase from './fs-driver-base';
import Resource from './models/Resource';
import Setting from './models/Setting';
import { ProfileDatabaseBinding } from './openProfileDatabase';
import EncryptionService from './services/e2ee/EncryptionService';
import FileHandler, {
	SettingsFileHandler,
} from './models/settings/FileHandler';
import { filename } from './path-utils';
import type { ProfileConfigStorage } from './services/profileConfig';

export interface ProfileResourceFileSystem extends FsDriverBase {
	resourceDirectory(): string;
}

export interface ProfileStorageBinding {
	database: ProfileDatabaseBinding;
	profileConfig: ProfileConfigStorage;
	privateData: ProfilePrivateData;
	resourceFileSystem: ProfileResourceFileSystem;
}

export interface ProfilePrivateData {
	write(scope: 'settings', key: string, content: Uint8Array): Promise<void>;
	read(scope: 'settings', key: string): Promise<Uint8Array|undefined>;
	remove(scope: 'settings', key: string): Promise<void>;
}

export const makePrivateProfileSettingsHandler = (
	privateData: ProfilePrivateData,
	key: string,
): SettingsFileHandler => new FileHandler({
	description: `encrypted settings (${key})`,
	read: async () => {
		const content = await privateData.read('settings', key);
		return content ? Buffer.from(content).toString('utf8') : undefined;
	},
	write: content => privateData.write(
		'settings',
		key,
		Buffer.from(content, 'utf8'),
	),
});

export const makePrivateProfileConfigStorage = (
	privateData: ProfilePrivateData,
): ProfileConfigStorage => ({
	description: 'encrypted profile configuration',
	read: async () => {
		const content = await privateData.read('settings', 'profiles');
		return content ? Buffer.from(content).toString('utf8') : undefined;
	},
	write: content => privateData.write(
		'settings',
		'profiles',
		Buffer.from(content, 'utf8'),
	),
});

interface StockProfileStorage {
	database: ProfileDatabaseBinding;
	resourceDirectory: string;
}

export interface ResolvedProfileStorage extends StockProfileStorage {
	resourceFileSystem?: ProfileResourceFileSystem;
}

const resolveProfileStorageBinding = (
	binding: ProfileStorageBinding|undefined,
	createStock: ()=> StockProfileStorage,
): ResolvedProfileStorage => {
	const stock = binding ? undefined : createStock();
	const resourceFileSystem = binding?.resourceFileSystem;
	const resourceDirectory = resourceFileSystem?.resourceDirectory() ?? stock!.resourceDirectory;
	const privateData = binding?.privateData;

	Setting.setConstant('resourceDirName', 'resources');
	Setting.setConstant('resourceDir', resourceDirectory);
	if (resourceFileSystem) {
		Resource.fsDriver_ = resourceFileSystem;
		EncryptionService.fsDriver_ = resourceFileSystem;
	}
	if (privateData) {
		const handlerFactory = (key: string): (()=> SettingsFileHandler) => {
			return () => makePrivateProfileSettingsHandler(privateData, key);
		};
		const profileKey = Setting.value('isSubProfile') ?
			`profile:${filename(Setting.value('profileDir'))}` :
			'profile:default';
		Setting.setFileHandlerFactories(
			handlerFactory(profileKey),
			handlerFactory('root'),
		);
	} else {
		Setting.setFileHandlerFactories();
	}

	return {
		database: binding?.database ?? stock!.database,
		resourceDirectory,
		resourceFileSystem,
	};
};

export default resolveProfileStorageBinding;
