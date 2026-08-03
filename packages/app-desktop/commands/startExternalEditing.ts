import { CommandRuntime, CommandDeclaration, CommandContext } from '@joplin/lib/services/CommandService';
import { _ } from '@joplin/lib/locale';
import { stateUtils } from '@joplin/lib/reducer';
import ExternalEditWatcher from '@joplin/lib/services/ExternalEditWatcher';
import Note from '@joplin/lib/models/Note';
import bridge from '../services/bridge';
import Setting from '@joplin/lib/models/Setting';

export const declaration: CommandDeclaration = {
	name: 'startExternalEditing',
	label: () => _('Open in external editor'),
	iconName: 'icon-share',
};

export const runtime = (): CommandRuntime => {
	return {
		execute: async (context: CommandContext, noteId: string = null) => {
			if (!Setting.value('allowExternalEditing')) {
				throw new Error('External editing is unavailable for encrypted profiles');
			}
			noteId = noteId || stateUtils.selectedNoteId(context.state);

			try {
				const note = await Note.load(noteId);
				void ExternalEditWatcher.instance().openAndWatch(note);
			} catch (error) {
				bridge().showErrorMessageBox(_('Error opening note in editor: %s', error.message));
			}
		},
		enabledCondition: Setting.value('allowExternalEditing') ?
			'oneNoteSelected && !noteIsReadOnly' : 'false',
		visibleCondition: Setting.value('allowExternalEditing') ? undefined : 'false',
	};
};
