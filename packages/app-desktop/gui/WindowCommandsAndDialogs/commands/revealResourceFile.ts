import { CommandRuntime, CommandDeclaration, CommandContext } from '@joplin/lib/services/CommandService';
import { _ } from '@joplin/lib/locale';
import Resource from '@joplin/lib/models/Resource';
import bridge from '../../../services/bridge';
import Setting from '@joplin/lib/models/Setting';
import { assertExternalEditingAllowed } from '@joplin/lib/services/externalEditingPolicy';

export const declaration: CommandDeclaration = {
	name: 'revealResourceFile',
	label: () =>_('Reveal file in folder'),
};

export const runtime = (): CommandRuntime => {
	return {
		execute: async (_context: CommandContext, itemId: string) => {
			assertExternalEditingAllowed();
			const resource = await Resource.load(itemId);
			if (!resource) throw new Error(`No such resource: ${itemId}`);
			const fullPath = Resource.fullPath(resource);
			bridge().showItemInFolder(fullPath);
		},
		enabledCondition: Setting.value('allowExternalEditing') ? undefined : 'false',
		visibleCondition: Setting.value('allowExternalEditing') ? undefined : 'false',
	};
};
