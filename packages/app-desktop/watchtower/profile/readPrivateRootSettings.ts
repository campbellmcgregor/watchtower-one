import {
	makePrivateProfileSettingsHandler,
	ProfilePrivateData,
} from '@joplin/lib/profileStorageBinding';
import type {
	SettingValues,
} from '@joplin/lib/models/settings/FileHandler';

const readPrivateRootSettings = (
	privateData: ProfilePrivateData,
): Promise<SettingValues> => {
	return makePrivateProfileSettingsHandler(privateData, 'root').load();
};

export default readPrivateRootSettings;
