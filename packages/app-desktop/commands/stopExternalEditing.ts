import { CommandRuntime, CommandDeclaration, CommandContext } from '@joplin/lib/services/CommandService';
import { _ } from '@joplin/lib/locale';
import { stateUtils } from '@joplin/lib/reducer';
import ExternalEditWatcher from '@joplin/lib/services/ExternalEditWatcher';
import Setting from '@joplin/lib/models/Setting';

export const declaration: CommandDeclaration = {
	name: 'stopExternalEditing',
	label: () => _('Stop external editing'),
	iconName: 'fa-stop',
};

export const runtime = (): CommandRuntime => {
	return {
		execute: async (context: CommandContext, noteId: string = null) => {
			if (!Setting.value('allowExternalEditing')) return;
			noteId = noteId || stateUtils.selectedNoteId(context.state);
			void ExternalEditWatcher.instance().stopWatching(noteId);
		},
		enabledCondition: Setting.value('allowExternalEditing') ?
			'oneNoteSelected && !noteIsReadOnly' : 'false',
		visibleCondition: Setting.value('allowExternalEditing') ? undefined : 'false',
	};
};
