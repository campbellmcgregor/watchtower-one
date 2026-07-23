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
	close(signal: AbortSignal): Promise<void>;
	terminate(): boolean;
}

export type VaultOpenResult =
	{ kind: 'opened'; handle: VaultOpenHandle }|
	{ kind: 'rejected'; reason: VaultRejectionReason }|
	{ kind: 'failedClosed'; reason: VaultAccessFailureReason };

export interface VaultAccessAdapter {
	create(signal: AbortSignal): Promise<VaultOpenResult>;
	unlock(signal: AbortSignal): Promise<VaultOpenResult>;
	recover(signal: AbortSignal): Promise<VaultOpenResult>;
	abort(operation: VaultAccessOperation): boolean;
}

export type ProfileStopResult =
	{ kind: 'stopped' }|
	{ kind: 'egressResidue'; paths: string[] };

declare const vaultSessionCapabilityBrand: unique symbol;
export type VaultSessionCapability = (()=> void) & {
	readonly [vaultSessionCapabilityBrand]: true;
};

// This host is the sole profile-start boundary. Its start implementation must
// lazy-load Joplin profile code, and terminate must synchronously confirm the
// content-bearing process tree is no longer running.
export interface ProfileHost {
	start(capability: VaultSessionCapability, signal: AbortSignal): Promise<void>;
	stop(reason: VaultEndReason, signal: AbortSignal): Promise<ProfileStopResult>;
	terminate(): boolean;
}

export interface VaultBootstrapOptions {
	operationTimeoutMs: number;
}

export type VaultStartResult =
	{ kind: 'unlocked' }|
	{ kind: 'rejected'; reason: VaultRejectionReason|VaultLifecycleRejectionReason }|
	{ kind: 'failedClosed'; stage: 'vaultAccess'|'vaultAccessTerminate'; reason?: VaultAccessFailureReason; timedOut?: true }|
	{ kind: 'failedClosed'; stage: 'profileStart'|'profileTerminate'|'vaultClose'|'vaultTerminate'; timedOut?: true };

export type VaultEndResult =
	{ kind: 'locked' }|
	{ kind: 'lockedWithEgressResidue'; paths: string[] }|
	{ kind: 'rejected'; reason: 'alreadyLocked'|'busy'|'egressResiduePresent'|'failedClosed' }|
	{ kind: 'failedClosed'; stage: 'profileStop'|'profileTerminate'|'vaultClose'|'vaultTerminate'; timedOut?: true };

const issueVaultSessionCapability = () => {
	let active = true;
	const capability = (() => {
		if (!active) throw new Error('Vault Session is not active');
	}) as VaultSessionCapability;

	return {
		capability,
		revoke: () => {
			active = false;
		},
	};
};

type BoundedOperationResult<T> =
	{ kind: 'completed'; value: T }|
	{ kind: 'failed' }|
	{ kind: 'timedOut' };

type VaultCloseResult =
	{ kind: 'closed' }|
	{ kind: 'failed'; terminated: boolean; timedOut: boolean };

// This module intentionally imports no Electron, filesystem, Joplin, key, or
// storage implementation. Those details remain behind the two injected seams.
export default class PreProfileVaultBootstrap {
	private state_: VaultLifecycleState = 'locked';
	private openHandle_: VaultOpenHandle|null = null;
	private profileHost_: ProfileHost|null = null;
	private revokeSession_: (()=> void)|null = null;

	public constructor(
		private readonly accessAdapter_: VaultAccessAdapter,
		private readonly options_: VaultBootstrapOptions = { operationTimeoutMs: 30_000 },
	) {}

	public state(): VaultLifecycleState {
		return this.state_;
	}

	private terminateProfile_(profileHost: ProfileHost): boolean {
		try {
			return profileHost.terminate();
		} catch {
			return false;
		}
	}

	private abortAccess_(operation: VaultAccessOperation): boolean {
		try {
			return this.accessAdapter_.abort(operation);
		} catch {
			return false;
		}
	}

	private terminateVault_(openHandle: VaultOpenHandle): boolean {
		try {
			return openHandle.terminate();
		} catch {
			return false;
		}
	}

	private async runBounded_<T>(
		operation: (signal: AbortSignal)=> Promise<T>,
	): Promise<BoundedOperationResult<T>> {
		const controller = new AbortController();
		return await new Promise(resolve => {
			let settled = false;
			const finish = (result: BoundedOperationResult<T>) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				resolve(result);
			};
			const timeout = setTimeout(() => {
				controller.abort();
				finish({ kind: 'timedOut' });
			}, this.options_.operationTimeoutMs);

			void Promise.resolve().then(() => operation(controller.signal)).then(
				value => finish({ kind: 'completed', value }),
				() => finish({ kind: 'failed' }),
			);
		});
	}

	private async closeVault_(openHandle: VaultOpenHandle): Promise<VaultCloseResult> {
		const closeResult = await this.runBounded_(signal => openHandle.close(signal));
		if (closeResult.kind === 'completed') return { kind: 'closed' };
		return {
			kind: 'failed',
			terminated: this.terminateVault_(openHandle),
			timedOut: closeResult.kind === 'timedOut',
		};
	}

	public async start(
		operation: VaultAccessOperation,
		profileHost: ProfileHost,
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
		const vaultAccessResult = await this.runBounded_(
			signal => this.accessAdapter_[operation](signal),
		);
		if (vaultAccessResult.kind !== 'completed') {
			const accessTerminated = this.abortAccess_(operation);
			this.state_ = 'failedClosed';
			return {
				kind: 'failedClosed',
				stage: accessTerminated ? 'vaultAccess' : 'vaultAccessTerminate',
				...(vaultAccessResult.kind === 'timedOut' ? { timedOut: true as const } : {}),
			};
		}
		const openResult = vaultAccessResult.value;

		if (openResult.kind === 'rejected') {
			this.state_ = 'locked';
			return openResult;
		}

		if (openResult.kind === 'failedClosed') {
			this.state_ = 'failedClosed';
			return { ...openResult, stage: 'vaultAccess' };
		}

		const sessionAuthority = issueVaultSessionCapability();
		const profileStartResult = await this.runBounded_(
			signal => profileHost.start(sessionAuthority.capability, signal),
		);
		if (profileStartResult.kind === 'completed') {
			this.openHandle_ = openResult.handle;
			this.profileHost_ = profileHost;
			this.revokeSession_ = sessionAuthority.revoke;
		} else {
			sessionAuthority.revoke();
			const profileTerminated = this.terminateProfile_(profileHost);
			const vaultCloseResult = await this.closeVault_(openResult.handle);
			this.state_ = 'failedClosed';
			if (!profileTerminated) {
				return { kind: 'failedClosed', stage: 'profileTerminate' };
			}
			if (vaultCloseResult.kind === 'failed') {
				return {
					kind: 'failedClosed',
					stage: vaultCloseResult.terminated ? 'vaultClose' : 'vaultTerminate',
					...(vaultCloseResult.timedOut ? { timedOut: true as const } : {}),
				};
			}
			return {
				kind: 'failedClosed',
				stage: 'profileStart',
				...(profileStartResult.kind === 'timedOut' ? { timedOut: true as const } : {}),
			};
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
		this.revokeSession_!();
		this.revokeSession_ = null;
		let profileStopResult: ProfileStopResult|undefined;
		let profileTerminated = true;
		const profileStopOperation = await this.runBounded_(
			signal => this.profileHost_!.stop(reason, signal),
		);
		if (profileStopOperation.kind === 'completed') {
			profileStopResult = profileStopOperation.value;
		} else {
			// Closing the vault is still mandatory when profile teardown reports
			// failure. The result below must not claim an ordinary locked state.
			profileTerminated = this.terminateProfile_(this.profileHost_!);
		}
		const vaultCloseResult = await this.closeVault_(this.openHandle_!);
		this.profileHost_ = null;
		this.openHandle_ = null;

		if (!profileTerminated) {
			this.state_ = 'failedClosed';
			return { kind: 'failedClosed', stage: 'profileTerminate' };
		}

		if (vaultCloseResult.kind === 'failed') {
			this.state_ = 'failedClosed';
			return {
				kind: 'failedClosed',
				stage: vaultCloseResult.terminated ? 'vaultClose' : 'vaultTerminate',
				...(vaultCloseResult.timedOut ? { timedOut: true as const } : {}),
			};
		}

		if (!profileStopResult) {
			this.state_ = 'failedClosed';
			return {
				kind: 'failedClosed',
				stage: 'profileStop',
				...(profileStopOperation.kind === 'timedOut' ? { timedOut: true as const } : {}),
			};
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
