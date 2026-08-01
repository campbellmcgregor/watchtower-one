import {
	ProfileStopResult,
	VaultEndReason,
} from '../vault/PreProfileVaultBootstrap';
import EncryptedResourceFsDriver from './EncryptedResourceFsDriver';
import EphemeralProfileRuntime from './EphemeralProfileRuntime';
import { EphemeralElectronSessionFactory } from './ephemeralProfileRuntimeTypes';
import {
	EncryptedProfileDatabase,
	EphemeralProfileArtifacts,
	PrivateProfileData,
	ResourceContent,
} from './profileStorageTypes';
import type { ProfilePluginCodeDirectories } from '@joplin/lib/profileStorageBinding';

export interface JoplinEncryptedProfile {
	database: EncryptedProfileDatabase;
	ephemeralRuntime: EphemeralProfileRuntime;
	publicVaultLockFilePath: string;
	resources: ResourceContent;
	resourceFileSystem: EncryptedResourceFsDriver;
	privateData: PrivateProfileData;
	pluginCode: ProfilePluginCodeDirectories;
	ephemeral: EphemeralProfileArtifacts;
}

export interface JoplinProfileRuntime {
	start(profile: JoplinEncryptedProfile, signal: AbortSignal): Promise<void>;
	stop(reason: VaultEndReason, signal: AbortSignal): Promise<ProfileStopResult>;
	terminate(): boolean;
}

export type LoadJoplinProfileRuntime = ()=> Promise<JoplinProfileRuntime>;

export interface EncryptedJoplinProfileHostOptions {
	ephemeralSessionFactory: EphemeralElectronSessionFactory;
	pluginCode: ProfilePluginCodeDirectories;
	publicVaultLockFilePath: string;
	resourceDirectory: string;
}
