import { randomUUID } from 'crypto';
import { VaultSessionCapability } from '../vault/PreProfileVaultBootstrap';

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

export default class EphemeralProfileRuntime {

	private capability_: VaultSessionCapability|undefined;
	private partition_: string|undefined;
	private session_: EphemeralElectronSession|undefined;

	public constructor(
		private readonly sessionFactory_: EphemeralElectronSessionFactory,
	) {}

	private async disposeSession_(session: EphemeralElectronSession) {
		const errors: unknown[] = [];
		for (const dispose of [
			() => session.closeAllConnections(),
			() => session.clearStorageData(),
			() => session.clearCache(),
		]) {
			try {
				await dispose();
			} catch (error) {
				errors.push(error);
			}
		}
		if (errors.length) throw new Error('Ephemeral Electron session cleanup failed');
	}

	public async start(capability: VaultSessionCapability): Promise<void> {
		if (this.session_) throw new Error('Ephemeral profile runtime is already active');
		const lease = capability();
		try {
			lease();
			const partition = `watchtower-session-${randomUUID()}`;
			const session = await this.sessionFactory_.fromPartition(
				partition,
				{ cache: false },
			);
			if (session.storagePath !== null) {
				await this.disposeSession_(session);
				throw new Error('Electron session is not memory-only');
			}
			this.capability_ = capability;
			this.partition_ = partition;
			this.session_ = session;
		} finally {
			lease.release();
		}
	}

	public session(): EphemeralElectronSession {
		if (!this.session_ || !this.capability_) {
			throw new Error('Ephemeral profile runtime is not active');
		}
		const lease = this.capability_();
		try {
			lease();
			return this.session_;
		} finally {
			lease.release();
		}
	}

	public partition(): string {
		this.session();
		return this.partition_!;
	}

	public async dispose(): Promise<void> {
		const session = this.session_;
		this.session_ = undefined;
		this.capability_ = undefined;
		this.partition_ = undefined;
		if (session) await this.disposeSession_(session);
	}

	public terminate(): boolean {
		this.session_ = undefined;
		this.capability_ = undefined;
		this.partition_ = undefined;
		return true;
	}
}
