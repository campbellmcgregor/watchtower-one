import type {
	BrowserWindowConstructorOptions,
	Session,
} from 'electron';

const selectJoplinElectronSession = (
	suppliedSession: Session|undefined,
	createStockSession: ()=> Session,
): Session => suppliedSession ?? createStockSession();

export const bindSuppliedSessionToWindow = (
	options: BrowserWindowConstructorOptions,
	suppliedSession: Session|undefined,
): BrowserWindowConstructorOptions => {
	if (!suppliedSession) return options;
	const requestedSession = options.webPreferences?.session;
	if (requestedSession && requestedSession !== suppliedSession) {
		throw new Error('Content-bearing window requested a different Electron session');
	}
	return {
		...options,
		webPreferences: {
			...options.webPreferences,
			session: suppliedSession,
		},
	};
};

export default selectJoplinElectronSession;
