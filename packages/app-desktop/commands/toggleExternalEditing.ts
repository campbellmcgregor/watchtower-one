import CommandService, { CommandRuntime, CommandDeclaration } from '@joplin/lib/services/CommandService';
import { _ } from '@joplin/lib/locale';
import { stateUtils } from '@joplin/lib/reducer';
import { DesktopCommandContext } from '../services/commands/types';
import Setting from '@joplin/lib/models/Setting';

export const declaration: CommandDeclaration = {
	name: 'toggleExternalEditing',
	label: () => _('Toggle external editing'),
	iconName: 'icon-share',
};

export const runtime = (): CommandRuntime => {
	return {
		execute: async (context: DesktopCommandContext, noteId: string = null) => {
			if (!Setting.value('allowExternalEditing')) return;
			noteId = noteId || stateUtils.selectedNoteId(context.state);

			if (!noteId) return;

			if (context.state.watchedNoteFiles.includes(noteId)) {
				void CommandService.instance().execute('stopExternalEditing', noteId);
			} else {
				void CommandService.instance().execute('startExternalEditing', noteId);
			}
		},
		enabledCondition: Setting.value('allowExternalEditing') ?
			'oneNoteSelected && !noteIsReadOnly && (!modalDialogVisible || gotoAnythingVisible)' : 'false',
		visibleCondition: Setting.value('allowExternalEditing') ? undefined : 'false',
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Old code before rule was applied
		mapStateToTitle: (state: any) => {
			const noteId = stateUtils.selectedNoteId(state);
			return state.watchedNoteFiles.includes(noteId) ? _('Stop') : '';
		},
	};
};
