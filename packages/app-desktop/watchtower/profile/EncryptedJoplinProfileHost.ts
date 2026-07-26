import {
	ProfileHost,
	ProfileStopResult,
	VaultEndReason,
	VaultSessionCapability,
	VaultSessionLease,
} from '../vault/PreProfileVaultBootstrap';
import EncryptedProfileStorage from './EncryptedProfileStorage';
import { EncryptedProfileDatabase } from './profileStorageTypes';
import EncryptedResourceFsDriver from './EncryptedResourceFsDriver';
import EphemeralProfileRuntime from './EphemeralProfileRuntime';
import {
	EncryptedJoplinProfileHostOptions,
	JoplinProfileRuntime,
	LoadJoplinProfileRuntime,
} from './joplinProfileTypes';

interface ScopedSessionAuthority {
	capability: VaultSessionCapability;
	beginClosing(): Promise<void>;
	revoke(): void;
}

const issueScopedSessionAuthority = (
	parentLease: VaultSessionLease,
): ScopedSessionAuthority => {
	let state: 'active'|'closing'|'revoked' = 'active';
	const activeLeases = new Set<symbol>();
	let resolveDrain: (()=> void)|undefined;

	const completeDrainIfPossible = () => {
		if (state !== 'closing' || activeLeases.size || !resolveDrain) return;
		resolveDrain();
		resolveDrain = undefined;
	};

	const capability = (() => {
		parentLease();
		if (state !== 'active') throw new Error('Vault Session is not accepting new work');
		const leaseId = Symbol('WatchtowerProfileSessionLease');
		activeLeases.add(leaseId);
		let released = false;
		const lease = (() => {
			parentLease();
			if (released || state === 'revoked') throw new Error('Vault Session is not active');
		}) as VaultSessionLease;
		lease.release = () => {
			if (released) return;
			released = true;
			activeLeases.delete(leaseId);
			completeDrainIfPossible();
		};
		return lease;
	}) as VaultSessionCapability;

	return {
		capability,
		beginClosing: () => {
			if (state === 'active') state = 'closing';
			if (!activeLeases.size) return Promise.resolve();
			return new Promise(resolve => {
				resolveDrain = resolve;
			});
		},
		revoke: () => {
			state = 'revoked';
			activeLeases.clear();
			resolveDrain?.();
			resolveDrain = undefined;
		},
	};
};

export default class EncryptedJoplinProfileHost implements ProfileHost {

	private runtime_: JoplinProfileRuntime|undefined;
	private database_: EncryptedProfileDatabase|undefined;
	private ephemeralRuntime_: EphemeralProfileRuntime|undefined;
	private rootLease_: VaultSessionLease|undefined;
	private sessionAuthority_: ScopedSessionAuthority|undefined;

	public constructor(
		private readonly storage_: ()=> EncryptedProfileStorage,
		private readonly loadRuntime_: LoadJoplinProfileRuntime,
		private readonly options_: EncryptedJoplinProfileHostOptions,
	) {}

	public async start(
		capability: VaultSessionCapability,
		signal: AbortSignal,
	): Promise<void> {
		if (this.runtime_) throw new Error('Encrypted Joplin profile is already running');

		const rootLease = capability();
		rootLease();
		const sessionAuthority = issueScopedSessionAuthority(rootLease);
		const scopedCapability = sessionAuthority.capability;
		const storage = this.storage_();
		const database = storage.database(scopedCapability);
		const ephemeralRuntime = new EphemeralProfileRuntime(
			this.options_.ephemeralSessionFactory,
		);
		try {
			await ephemeralRuntime.start(scopedCapability);
			const runtime = await this.loadRuntime_();
			this.database_ = database;
			this.ephemeralRuntime_ = ephemeralRuntime;
			this.rootLease_ = rootLease;
			this.sessionAuthority_ = sessionAuthority;
			this.runtime_ = runtime;
			const resources = storage.resources(scopedCapability);
			await runtime.start({
				database,
				ephemeralRuntime,
				resources,
				resourceFileSystem: new EncryptedResourceFsDriver(
					this.options_.resourceDirectory,
					resources,
				),
				privateData: storage.privateData(scopedCapability),
				ephemeral: storage.ephemeral(scopedCapability),
			}, signal);
		} catch (error) {
			this.runtime_?.terminate();
			this.runtime_ = undefined;
			this.ephemeralRuntime_ = undefined;
			this.database_ = undefined;
			this.sessionAuthority_ = undefined;
			this.rootLease_ = undefined;
			try {
				await ephemeralRuntime.dispose();
			} finally {
				try {
					await database.close();
				} finally {
					sessionAuthority.revoke();
					rootLease.release();
				}
			}
			throw error;
		}
	}

	public async stop(
		reason: VaultEndReason,
		signal: AbortSignal,
	): Promise<ProfileStopResult> {
		if (
			!this.runtime_ ||
			!this.database_ ||
			!this.ephemeralRuntime_ ||
			!this.rootLease_ ||
			!this.sessionAuthority_
		) {
			throw new Error('Encrypted Joplin profile is not running');
		}

		const runtime = this.runtime_;
		const database = this.database_;
		const ephemeralRuntime = this.ephemeralRuntime_;
		const rootLease = this.rootLease_;
		const sessionAuthority = this.sessionAuthority_;
		try {
			return await runtime.stop(reason, signal);
		} finally {
			try {
				await sessionAuthority.beginClosing();
				await ephemeralRuntime.dispose();
			} finally {
				try {
					await database.close();
				} finally {
					sessionAuthority.revoke();
					rootLease.release();
					this.runtime_ = undefined;
					this.database_ = undefined;
					this.ephemeralRuntime_ = undefined;
					this.rootLease_ = undefined;
					this.sessionAuthority_ = undefined;
				}
			}
		}
	}

	public terminate(): boolean {
		if (!this.runtime_ && !this.ephemeralRuntime_) return true;
		try {
			const runtimeTerminated = this.runtime_?.terminate() ?? true;
			const ephemeralTerminated = this.ephemeralRuntime_?.terminate() ?? true;
			return runtimeTerminated && ephemeralTerminated;
		} finally {
			this.sessionAuthority_?.revoke();
			this.rootLease_?.release();
			this.runtime_ = undefined;
			this.database_ = undefined;
			this.ephemeralRuntime_ = undefined;
			this.rootLease_ = undefined;
			this.sessionAuthority_ = undefined;
		}
	}
}
