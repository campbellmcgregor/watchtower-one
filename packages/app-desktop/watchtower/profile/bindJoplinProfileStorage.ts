import { ProfileStorageBinding } from '@joplin/lib/profileStorageBinding';
import { JoplinEncryptedProfile } from './joplinProfileTypes';
import { encryptedProfileDatabaseName } from './profileStorageTypes';

const bindJoplinProfileStorage = (
	profile: Pick<JoplinEncryptedProfile, 'database'|'resourceFileSystem'>,
): ProfileStorageBinding => {
	return {
		database: {
			driver: profile.database,
			name: encryptedProfileDatabaseName,
		},
		resourceFileSystem: profile.resourceFileSystem,
	};
};

export default bindJoplinProfileStorage;
