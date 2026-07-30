import {
	makePrivateProfileConfigStorage,
	ProfileStorageBinding,
} from '@joplin/lib/profileStorageBinding';
import { JoplinEncryptedProfile } from './joplinProfileTypes';
import { encryptedProfileDatabaseName } from './profileStorageTypes';

const bindJoplinProfileStorage = (
	profile: Pick<JoplinEncryptedProfile, 'database'|'privateData'|'resourceFileSystem'>,
): ProfileStorageBinding => {
	return {
		database: {
			driver: profile.database,
			name: encryptedProfileDatabaseName,
		},
		profileConfig: makePrivateProfileConfigStorage(profile.privateData),
		privateData: profile.privateData,
		resourceFileSystem: profile.resourceFileSystem,
	};
};

export default bindJoplinProfileStorage;
