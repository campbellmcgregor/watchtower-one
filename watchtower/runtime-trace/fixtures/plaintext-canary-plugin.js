/* eslint-disable multiline-comment-style, no-undef */

/* joplin-manifest:
{
	"id": "com.watchtower.runtime-plaintext-trace",
	"manifest_version": 1,
	"app_min_version": "3.6",
	"name": "Watchtower Runtime Plaintext Trace",
	"description": "Test-only plugin used to trace plugin-owned persistence.",
	"version": "1.0.0",
	"author": "Watchtower maintainers"
}
*/

const pluginCanary = 'WT1-ISSUE7-PLUGIN-CANARY-20260723';

joplin.plugins.register({
	onStart: async () => {
		await joplin.settings.registerSettings({
			traceCanary: {
				value: '',
				type: 2,
				storage: 2,
				public: false,
				label: 'Watchtower trace canary',
			},
		});
		await joplin.commands.register({
			name: 'watchtowerTracePluginReady',
			label: 'Watchtower trace plugin ready',
			execute: async () => {
				await joplin.settings.setValue('traceCanary', pluginCanary);
			},
		});
	},
});
