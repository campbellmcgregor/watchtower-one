import Setting from '../models/Setting';

export const externalEditingAllowed = () => Setting.value('allowExternalEditing');

export const assertExternalEditingAllowed = () => {
	if (!externalEditingAllowed()) {
		throw new Error('External editing is unavailable for encrypted profiles');
	}
};
