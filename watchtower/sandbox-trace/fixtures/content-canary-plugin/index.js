/* eslint-disable multiline-comment-style, no-undef */

const canary = (kind) => [
	'WT1',
	'-ISSUE37',
	`-${kind}-`,
	'CANARY-',
	'20260723',
].join('');

joplin.plugins.register({
	onStart: async () => {
		const fs = joplin.plugins.require('fs-extra');
		const dataDirectory = await joplin.plugins.dataDir();
		const completionPath = `${dataDirectory}/trace-complete.json`;

		try {
			await joplin.settings.registerSettings({
				traceCanary: {
					value: '',
					type: 2,
					storage: 2,
					public: false,
					label: 'Watchtower packaged trace canary',
				},
			});

			const pluginCanary = canary('PLUGIN');
			const resourceCanary = canary('RESOURCE');
			const resourceInputPath = `${dataDirectory}/resource-input.txt`;
			await fs.outputFile(resourceInputPath, resourceCanary, 'utf8');

			const folder = await joplin.data.post(['folders'], null, {
				title: 'Watchtower packaged content trace',
			});
			const resource = await joplin.data.post(['resources'], null, {
				title: 'watchtower-packaged-resource.txt',
			}, [{ path: resourceInputPath }]);
			const note = await joplin.data.post(['notes'], null, {
				parent_id: folder.id,
				title: 'Watchtower packaged content trace',
				body: `${canary('NOTE')}\n\n[Packaged resource](:/${resource.id})`,
			});

			await joplin.settings.setValue('traceCanary', pluginCanary);
			await fs.outputFile(`${dataDirectory}/plugin-data.txt`, pluginCanary, 'utf8');
			await fs.writeJson(completionPath, {
				schemaVersion: 1,
				noteId: note.id,
				resourceId: resource.id,
			});
		} catch (error) {
			await fs.writeJson(`${dataDirectory}/trace-failure.json`, {
				schemaVersion: 1,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	},
});
