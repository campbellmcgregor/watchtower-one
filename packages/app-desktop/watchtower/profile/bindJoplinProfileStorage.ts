import { ProfileDatabaseBinding } from '@joplin/lib/openProfileDatabase';
import Resource from '@joplin/lib/models/Resource';
import Setting from '@joplin/lib/models/Setting';
import EncryptionService from '@joplin/lib/services/e2ee/EncryptionService';
import { JoplinEncryptedProfile } from './joplinProfileTypes';
import { encryptedProfileDatabaseName } from './profileStorageTypes';

const bindJoplinProfileStorage = (
	profile: Pick<JoplinEncryptedProfile, 'database'|'resourceFileSystem'>,
): ProfileDatabaseBinding => {
	const resourceDirectory = profile.resourceFileSystem.resourceDirectory();
	Setting.setConstant('resourceDirName', 'resources');
	Setting.setConstant('resourceDir', resourceDirectory);
	Resource.fsDriver_ = profile.resourceFileSystem;
	EncryptionService.fsDriver_ = profile.resourceFileSystem;

	return {
		driver: profile.database,
		name: encryptedProfileDatabaseName,
	};
};

export default bindJoplinProfileStorage;
