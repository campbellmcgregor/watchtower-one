import FsDriverBase from './fs-driver-base';
import Resource from './models/Resource';
import Setting from './models/Setting';
import { ProfileDatabaseBinding } from './openProfileDatabase';
import EncryptionService from './services/e2ee/EncryptionService';
import FileHandler, {
	SettingsFileHandler,
} from './models/settings/FileHandler';
import { basename, filename } from './path-utils';
import type { ProfileConfigStorage } from './services/profileConfig';
import Logger from '@joplin/utils/Logger';

export interface ProfileResourceFileSystem extends FsDriverBase {
	resourceDirectory(): string;
}

export interface ProfileLogFileSystem {
	appendFile(path: string, content: string, encoding: string): Promise<void>;
}

export interface ProfileEphemeralLogArtifacts {
	write(category: 'log', key: string, content: Uint8Array): Promise<void>;
	read(category: 'log', key: string): Promise<Uint8Array|undefined>;
}

const maximumEphemeralProfileLogBytes = 5 * 1024 * 1024;

const boundedUtf8Suffix = (
	content: Buffer,
	maximumBytes: number,
): Buffer => {
	let start = Math.max(0, content.byteLength - maximumBytes);
	while (
		start < content.byteLength &&
		(content[start] & 0xC0) === 0x80
	) {
		start++;
	}
	return content.subarray(start);
};

const boundedUtf16Suffix = (
	content: string,
	maximumCodeUnits: number,
): string => {
	let start = Math.max(0, content.length - maximumCodeUnits);
	if (
		start > 0 &&
		start < content.length &&
		content.charCodeAt(start) >= 0xDC00 &&
		content.charCodeAt(start) <= 0xDFFF &&
		content.charCodeAt(start - 1) >= 0xD800 &&
		content.charCodeAt(start - 1) <= 0xDBFF
	) {
		start++;
	}
	return content.slice(start);
};

export interface ProfileStorageBinding {
	database: ProfileDatabaseBinding;
	logFileSystem: ProfileLogFileSystem;
	profileConfig: ProfileConfigStorage;
	privateData: ProfilePrivateData;
	publicVaultLockFilePath: string;
	resourceFileSystem: ProfileResourceFileSystem;
}

export type ProfilePrivateDataScope = 'settings'|`plugin:${string}`;

export interface ProfilePrivateData {
	write(scope: ProfilePrivateDataScope, key: string, content: Uint8Array): Promise<void>;
	read(scope: ProfilePrivateDataScope, key: string): Promise<Uint8Array|undefined>;
	list(scope: ProfilePrivateDataScope): Promise<string[]>;
	remove(scope: ProfilePrivateDataScope, key: string): Promise<void>;
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

export const makeEphemeralProfileLogFileSystem = (
	artifacts: ProfileEphemeralLogArtifacts,
): ProfileLogFileSystem => ({
	appendFile: async (path, content, encoding) => {
		if (encoding.toLowerCase() !== 'utf8') {
			throw new Error('Ephemeral profile logs require UTF-8 content');
		}
		const key = basename(path);
		if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(key)) {
			throw new Error('Ephemeral profile log name is invalid');
		}
		const previous = await artifacts.read('log', key);
		const boundedSource = boundedUtf16Suffix(
			content,
			maximumEphemeralProfileLogBytes,
		);
		const incoming = boundedUtf8Suffix(
			Buffer.from(boundedSource, 'utf8'),
			maximumEphemeralProfileLogBytes,
		);
		const retainedPrevious = previous ?
			boundedUtf8Suffix(
				Buffer.from(previous),
				maximumEphemeralProfileLogBytes - incoming.byteLength,
			) :
			Buffer.alloc(0);
		await artifacts.write(
			'log',
			key,
			Buffer.concat([retainedPrevious, incoming]),
		);
	},
});

export class ProfileLogFileSystemBinding {

	private active_ = false;
	private previous_: ProfileLogFileSystem|null = null;

	public install(logFileSystem: ProfileLogFileSystem) {
		if (this.active_) throw new Error('Profile log filesystem is already installed');
		this.previous_ = Logger.fsDriver_;
		Logger.fsDriver_ = logFileSystem;
		this.active_ = true;
	}

	public async dispose(): Promise<void> {
		if (!this.active_) return;
		try {
			await new Logger().waitForFileWritesToComplete_();
		} finally {
			Logger.fsDriver_ = this.previous_;
			this.previous_ = null;
			this.active_ = false;
		}
	}
}

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
