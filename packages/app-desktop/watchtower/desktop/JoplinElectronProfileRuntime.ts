import type { Session } from 'electron';
import type { ProfileStorageBinding } from '@joplin/lib/profileStorageBinding';
import bindJoplinProfileStorage from '../profile/bindJoplinProfileStorage';
import type {
	JoplinEncryptedProfile,
	JoplinProfileRuntime,
} from '../profile/joplinProfileTypes';
import type {
	ProfileStopResult,
	VaultEndReason,
} from '../vault/PreProfileVaultBootstrap';

export interface JoplinElectronProfileProcess {
	closeProfileSession(): Promise<void>;
	terminateProfileSession(): boolean;
}

export type StartJoplinElectronProfile = (
	binding: ProfileStorageBinding,
	session: Session,
)=> Promise<JoplinElectronProfileProcess>;

export default class JoplinElectronProfileRuntime implements JoplinProfileRuntime {

	private process_: JoplinElectronProfileProcess|undefined;

	public constructor(private readonly startJoplin_: StartJoplinElectronProfile) {}

	public async start(profile: JoplinEncryptedProfile, signal: AbortSignal): Promise<void> {
		if (this.process_) throw new Error('Joplin Electron profile is already running');
		if (signal.aborted) throw new Error('Joplin Electron profile start was cancelled');
		const runtimeProcess = await this.startJoplin_(
			bindJoplinProfileStorage(profile),
			profile.ephemeralRuntime.electronSession(),
		);
		if (signal.aborted) {
			runtimeProcess.terminateProfileSession();
			throw new Error('Joplin Electron profile start was cancelled');
		}
		this.process_ = runtimeProcess;
	}

	public async stop(
		_reason: VaultEndReason,
		_signal: AbortSignal,
	): Promise<ProfileStopResult> {
		const process = this.process_;
		if (!process) throw new Error('Joplin Electron profile is not running');
		this.process_ = undefined;
		await process.closeProfileSession();
		return { kind: 'stopped' };
	}

	public terminate(): boolean {
		const process = this.process_;
		this.process_ = undefined;
		return process?.terminateProfileSession() ?? true;
	}
}

export const loadJoplinElectronProfileRuntime = async (): Promise<JoplinProfileRuntime> => {
	return new JoplinElectronProfileRuntime(async (binding, session) => {
		const { default: startJoplinMain } = await import('../../joplinMain');
		return startJoplinMain(binding, session);
	});
};
