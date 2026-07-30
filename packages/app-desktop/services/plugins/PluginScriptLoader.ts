export const pluginScriptSourceChannel = 'pluginScriptSource';

export interface PluginScriptTarget {
	loadURL(url: string): Promise<unknown>;
	webContents: {
		send(channel: string, payload: unknown): void;
	};
}

export interface PluginScriptLoadOptions {
	pageUrl: string;
	pluginId: string;
	scriptText: string;
	target: PluginScriptTarget;
}

export interface PluginScriptLoader {
	load(options: PluginScriptLoadOptions): Promise<void>;
}

export interface PluginScriptFileSystem {
	writeFile(path: string, content: string, encoding: string): Promise<void>;
}

export class FileBackedPluginScriptLoader implements PluginScriptLoader {

	public constructor(
		private readonly fileSystem_: PluginScriptFileSystem,
		private readonly tempDirectory_: ()=> string,
	) {}

	public async load(options: PluginScriptLoadOptions): Promise<void> {
		const scriptPath = `${this.tempDirectory_()}/plugin_${options.pluginId}.js`;
		await this.fileSystem_.writeFile(scriptPath, options.scriptText, 'utf8');
		const pageUrl = new URL(options.pageUrl);
		pageUrl.searchParams.set('pluginScript', `file://${scriptPath}`);
		await options.target.loadURL(pageUrl.toString());
	}
}

export class EphemeralPluginScriptLoader implements PluginScriptLoader {

	public async load(options: PluginScriptLoadOptions): Promise<void> {
		const pageUrl = new URL(options.pageUrl);
		pageUrl.searchParams.set('pluginScript', 'memory');
		await options.target.loadURL(pageUrl.toString());
		options.target.webContents.send(pluginScriptSourceChannel, {
			pluginId: options.pluginId,
			scriptText: options.scriptText,
		});
	}
}
