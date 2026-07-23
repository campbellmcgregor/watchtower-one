export type VaultAccessOperation = 'create'|'unlock'|'recover';
export type VaultEndReason = 'lock'|'close';
export type VaultLifecycleState =
	'locked'|
	'unlocking'|
	'unlocked'|
	'locking'|
	'lockedWithEgressResidue'|
	'failedClosed';

export type VaultRejectionReason =
	'alreadyExists'|
	'missingVault'|
	'wrongCredential'|
	'recoveryRejected';

export type VaultAccessFailureReason =
	'corruptVault'|
	'unsupportedVersion';

export type VaultLifecycleRejectionReason =
	'alreadyUnlocked'|
	'busy'|
	'egressResiduePresent'|
	'failedClosed';

export interface VaultOpenHandle {
	close(): Promise<void>;
}

export type VaultOpenResult =
	{ kind: 'opened'; handle: VaultOpenHandle }|
	{ kind: 'rejected'; reason: VaultRejectionReason }|
	{ kind: 'failedClosed'; reason: VaultAccessFailureReason };

export interface VaultAccessAdapter {
	create(): Promise<VaultOpenResult>;
	unlock(): Promise<VaultOpenResult>;
	recover(): Promise<VaultOpenResult>;
}

export type ProfileStopResult =
	{ kind: 'stopped' }|
	{ kind: 'egressResidue'; paths: string[] };

export interface ProfileRuntime {
	stop(reason: VaultEndReason): Promise<ProfileStopResult>;
}

declare const vaultSessionCapabilityBrand: unique symbol;
export type VaultSessionCapability = symbol & {
	readonly [vaultSessionCapabilityBrand]: true;
};

// This callback is the sole profile-start boundary. The desktop binding must
// lazy-load Joplin profile code from inside it, never before start() succeeds.
export type ProfileInitializer = (
	capability: VaultSessionCapability,
)=> Promise<ProfileRuntime>;

export type VaultStartResult =
	{ kind: 'unlocked' }|
	{ kind: 'rejected'; reason: VaultRejectionReason|VaultLifecycleRejectionReason }|
	{ kind: 'failedClosed'; stage: 'vaultAccess'; reason?: VaultAccessFailureReason }|
	{ kind: 'failedClosed'; stage: 'profileStart' };

export type VaultEndResult =
	{ kind: 'locked' }|
	{ kind: 'lockedWithEgressResidue'; paths: string[] }|
	{ kind: 'rejected'; reason: 'alreadyLocked'|'busy'|'egressResiduePresent'|'failedClosed' }|
	{ kind: 'failedClosed'; stage: 'profileStop'|'vaultClose' };

const issueVaultSessionCapability = (): VaultSessionCapability => (
	Symbol('WatchtowerVaultSession') as VaultSessionCapability
);

// This module intentionally imports no Electron, filesystem, Joplin, key, or
// storage implementation. Those details remain behind the two injected seams.
export default class PreProfileVaultBootstrap {
	private state_: VaultLifecycleState = 'locked';
	private openHandle_: VaultOpenHandle|null = null;
	private profileRuntime_: ProfileRuntime|null = null;

	public constructor(private readonly accessAdapter_: VaultAccessAdapter) {}

	public state(): VaultLifecycleState {
		return this.state_;
	}

	public async start(
		operation: VaultAccessOperation,
		initializeProfile: ProfileInitializer,
	): Promise<VaultStartResult> {
		if (this.state_ !== 'locked') {
			const reason: VaultLifecycleRejectionReason = (() => {
				switch (this.state_) {
				case 'unlocked': return 'alreadyUnlocked';
				case 'unlocking':
				case 'locking': return 'busy';
				case 'lockedWithEgressResidue': return 'egressResiduePresent';
				case 'failedClosed': return 'failedClosed';
				}
			})();
			return { kind: 'rejected', reason };
		}

		this.state_ = 'unlocking';
		let openResult: VaultOpenResult;
		try {
			openResult = await this.accessAdapter_[operation]();
		} catch {
			this.state_ = 'failedClosed';
			return { kind: 'failedClosed', stage: 'vaultAccess' };
		}

		if (openResult.kind === 'rejected') {
			this.state_ = 'locked';
			return openResult;
		}

		if (openResult.kind === 'failedClosed') {
			this.state_ = 'failedClosed';
			return { ...openResult, stage: 'vaultAccess' };
		}

		try {
			this.profileRuntime_ = await initializeProfile(issueVaultSessionCapability());
			this.openHandle_ = openResult.handle;
		} catch {
			try {
				await openResult.handle.close();
			} catch {
				// The failure result must remain sanitised and fail closed even when
				// cleanup also fails.
			}
			this.state_ = 'failedClosed';
			return { kind: 'failedClosed', stage: 'profileStart' };
		}
		this.state_ = 'unlocked';
		return { kind: 'unlocked' };
	}

	public async end(reason: VaultEndReason): Promise<VaultEndResult> {
		if (this.state_ !== 'unlocked') {
			switch (this.state_) {
			case 'locked': return { kind: 'rejected', reason: 'alreadyLocked' };
			case 'unlocking':
			case 'locking': return { kind: 'rejected', reason: 'busy' };
			case 'lockedWithEgressResidue': return { kind: 'rejected', reason: 'egressResiduePresent' };
			case 'failedClosed': return { kind: 'rejected', reason: 'failedClosed' };
			}
		}

		this.state_ = 'locking';
		let profileStopResult: ProfileStopResult|undefined;
		try {
			profileStopResult = await this.profileRuntime_!.stop(reason);
		} catch {
			// Closing the vault is still mandatory when profile teardown reports
			// failure. The result below must not claim an ordinary locked state.
		}
		let vaultClosed = false;
		try {
			await this.openHandle_!.close();
			vaultClosed = true;
		} catch {
			// The caller receives a stable failure stage, never adapter detail.
		}
		this.profileRuntime_ = null;
		this.openHandle_ = null;

		if (!vaultClosed) {
			this.state_ = 'failedClosed';
			return { kind: 'failedClosed', stage: 'vaultClose' };
		}

		if (!profileStopResult) {
			this.state_ = 'failedClosed';
			return { kind: 'failedClosed', stage: 'profileStop' };
		}

		if (profileStopResult.kind === 'egressResidue') {
			this.state_ = 'lockedWithEgressResidue';
			return {
				kind: 'lockedWithEgressResidue',
				paths: profileStopResult.paths,
			};
		}

		this.state_ = 'locked';
		return { kind: 'locked' };
	}
}
