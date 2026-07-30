import {
	makeEphemeralProfileLogFileSystem,
	makePrivateProfileConfigStorage,
	ProfileStorageBinding,
} from '@joplin/lib/profileStorageBinding';
import { JoplinEncryptedProfile } from './joplinProfileTypes';
import { encryptedProfileDatabaseName } from './profileStorageTypes';

const bindJoplinProfileStorage = (
	profile: Pick<JoplinEncryptedProfile, 'database'|'ephemeral'|'privateData'|'publicVaultLockFilePath'|'resourceFileSystem'>,
): ProfileStorageBinding => {
	return {
		database: {
			driver: profile.database,
			name: encryptedProfileDatabaseName,
		},
		logFileSystem: makeEphemeralProfileLogFileSystem(profile.ephemeral),
		profileConfig: makePrivateProfileConfigStorage(profile.privateData),
		privateData: profile.privateData,
		publicVaultLockFilePath: profile.publicVaultLockFilePath,
		resourceFileSystem: profile.resourceFileSystem,
	};
};

export default bindJoplinProfileStorage;
