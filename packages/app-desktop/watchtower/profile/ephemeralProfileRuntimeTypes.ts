import type { Session } from 'electron';

export interface EphemeralElectronSession {
	readonly browserSession: Session;
	readonly storagePath: string|null;
	clearCache(): Promise<void>;
	clearStorageData(): Promise<void>;
	closeAllConnections(): Promise<void>;
}

export interface EphemeralElectronSessionFactory {
	fromPartition(
		partition: string,
		options: { cache: false },
	): Promise<EphemeralElectronSession>;
}

export const makeElectronSessionFactory = (): EphemeralElectronSessionFactory => ({
	fromPartition: async (partition, options) => {
		const electron = await import('electron');
		const browserSession = electron.session.fromPartition(partition, options);
		return {
			browserSession,
			storagePath: browserSession.storagePath,
			clearCache: () => browserSession.clearCache(),
			clearStorageData: () => browserSession.clearStorageData(),
			closeAllConnections: () => browserSession.closeAllConnections(),
		};
	},
});
