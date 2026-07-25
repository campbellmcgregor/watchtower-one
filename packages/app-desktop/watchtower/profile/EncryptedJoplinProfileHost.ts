import {
	ProfileHost,
	ProfileStopResult,
	VaultEndReason,
	VaultSessionCapability,
} from '../vault/PreProfileVaultBootstrap';
import EncryptedProfileStorage, {
	EncryptedProfileDatabase,
	EphemeralProfileArtifacts,
	PrivateProfileData,
	ResourceContent,
	encryptedProfileDatabaseName,
} from './EncryptedProfileStorage';
import EncryptedResourceFsDriver from './EncryptedResourceFsDriver';
import EphemeralProfileRuntime, {
	EphemeralElectronSessionFactory,
} from './EphemeralProfileRuntime';

export interface JoplinEncryptedProfile {
	database: EncryptedProfileDatabase;
	ephemeralRuntime: EphemeralProfileRuntime;
	resources: ResourceContent;
	resourceFileSystem: EncryptedResourceFsDriver;
	privateData: PrivateProfileData;
	ephemeral: EphemeralProfileArtifacts;
}

export interface JoplinProfileRuntime {
	start(profile: JoplinEncryptedProfile, signal: AbortSignal): Promise<void>;
	stop(reason: VaultEndReason, signal: AbortSignal): Promise<ProfileStopResult>;
	terminate(): boolean;
}

export type LoadJoplinProfileRuntime = ()=> Promise<JoplinProfileRuntime>;

export interface EncryptedJoplinProfileHostOptions {
	ephemeralSessionFactory: EphemeralElectronSessionFactory;
	resourceDirectory: string;
}

export default class EncryptedJoplinProfileHost implements ProfileHost {

	private runtime_: JoplinProfileRuntime|undefined;
	private database_: EncryptedProfileDatabase|undefined;
	private ephemeralRuntime_: EphemeralProfileRuntime|undefined;

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

		const storage = this.storage_();
		const database = storage.database(capability);
		await database.open({ name: encryptedProfileDatabaseName });
		const ephemeralRuntime = new EphemeralProfileRuntime(
			this.options_.ephemeralSessionFactory,
		);
		try {
			await ephemeralRuntime.start(capability);
			const runtime = await this.loadRuntime_();
			this.database_ = database;
			this.ephemeralRuntime_ = ephemeralRuntime;
			this.runtime_ = runtime;
			const resources = storage.resources(capability);
			await runtime.start({
				database,
				ephemeralRuntime,
				resources,
				resourceFileSystem: new EncryptedResourceFsDriver(
					this.options_.resourceDirectory,
					resources,
				),
				privateData: storage.privateData(capability),
				ephemeral: storage.ephemeral(capability),
			}, signal);
		} catch (error) {
			this.runtime_?.terminate();
			this.runtime_ = undefined;
			this.ephemeralRuntime_ = undefined;
			this.database_ = undefined;
			try {
				await ephemeralRuntime.dispose();
			} finally {
				await database.close();
			}
			throw error;
		}
	}

	public async stop(
		reason: VaultEndReason,
		signal: AbortSignal,
	): Promise<ProfileStopResult> {
		if (!this.runtime_ || !this.database_ || !this.ephemeralRuntime_) {
			throw new Error('Encrypted Joplin profile is not running');
		}

		const runtime = this.runtime_;
		const database = this.database_;
		const ephemeralRuntime = this.ephemeralRuntime_;
		try {
			return await runtime.stop(reason, signal);
		} finally {
			try {
				await ephemeralRuntime.dispose();
			} finally {
				try {
					await database.close();
				} finally {
					this.runtime_ = undefined;
					this.database_ = undefined;
					this.ephemeralRuntime_ = undefined;
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
			this.runtime_ = undefined;
			this.database_ = undefined;
			this.ephemeralRuntime_ = undefined;
		}
	}
}
