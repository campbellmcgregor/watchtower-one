interface RoutedPluginMessage {
	pluginId: string;
	target: string;
}

interface MessageWindow<TWebContents> {
	webContents: TWebContents;
}

interface PluginMessageRouteContext<TWebContents> {
	mainWindow: MessageWindow<TWebContents>|null;
	pluginWindows: Record<string, MessageWindow<TWebContents>>;
}

const pluginMessageRecipient = <TWebContents>(
	sender: TWebContents,
	message: RoutedPluginMessage,
	context: PluginMessageRouteContext<TWebContents>,
): TWebContents|undefined => {
	if (message.target === 'mainWindow') {
		const pluginWindow = context.pluginWindows[message.pluginId];
		if (pluginWindow?.webContents !== sender) return undefined;
		return context.mainWindow?.webContents;
	}
	if (message.target === 'plugin') {
		if (context.mainWindow?.webContents !== sender) return undefined;
		return context.pluginWindows[message.pluginId]?.webContents;
	}
	return undefined;
};

export default pluginMessageRecipient;
