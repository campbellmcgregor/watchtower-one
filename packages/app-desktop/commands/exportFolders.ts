import { CommandRuntime, CommandDeclaration } from '@joplin/lib/services/CommandService';
import InteropService from '@joplin/lib/services/interop/InteropService';
import { ExportModuleOutputFormat, ExportOptions, FileSystemItem } from '@joplin/lib/services/interop/types';
import shim from '@joplin/lib/shim';
import bridge from '../services/bridge';
import { confirmExplicitPlaintextEgress, ExplicitPlaintextEgressKind } from '../watchtower/profile/explicitPlaintextEgress';

export const declaration: CommandDeclaration = {
	name: 'exportFolders',
};

export const runtime = (): CommandRuntime => {
	return {
		// "targetPath" should be a file for JEX export (because the format can
		// contain multiple folders) or a directory otherwise.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Old code before rule was applied
		execute: async (_context: any, folderIds: string[], format: ExportModuleOutputFormat, targetPath: string) => {
			if (!confirmExplicitPlaintextEgress(
				ExplicitPlaintextEgressKind.Export,
				(message, options) => bridge().showMessageBox(message, options),
			)) return null;

			const exportOptions: ExportOptions = {
				sourceFolderIds: folderIds,
				path: targetPath,
				format: format,
				target: FileSystemItem.Directory,
			};

			const targetMustBeFile = format === 'jex';
			const targetIsDir = await shim.fsDriver().isDirectory(targetPath);

			if (targetMustBeFile && targetIsDir) {
				throw new Error(`Format "${format}" can only be exported to a file`);
			}

			if (format === 'jex' || !targetIsDir) {
				exportOptions.target = FileSystemItem.File;
			}

			return InteropService.instance().export(exportOptions);
		},
	};
};
