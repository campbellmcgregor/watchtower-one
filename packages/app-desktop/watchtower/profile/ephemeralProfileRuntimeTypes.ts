export interface EphemeralElectronSession {
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
		return electron.session.fromPartition(partition, options);
	},
});
