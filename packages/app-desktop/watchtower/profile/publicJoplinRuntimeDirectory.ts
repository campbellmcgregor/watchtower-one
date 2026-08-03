import type { ProfileStorageBinding } from '@joplin/lib/profileStorageBinding';
import { dirname } from 'path';

const publicJoplinRuntimeDirectory = (profileStorage: ProfileStorageBinding) => {
	return dirname(profileStorage.publicVaultLockFilePath);
};

export default publicJoplinRuntimeDirectory;
