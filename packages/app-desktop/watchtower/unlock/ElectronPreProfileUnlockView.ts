import {
	BrowserWindow,
	IpcMainEvent,
	Session,
	ipcMain,
	session as electronSession,
} from 'electron';
import { randomUUID } from 'crypto';
import { join, resolve, sep } from 'path';
import { pathToFileURL } from 'url';
import type {
	PreProfileUnlockFeedback,
	PreProfileUnlockSubmission,
	PreProfileUnlockView,
} from '../desktop/runPreProfileUnlockFlow';
import {
	unlockCancelChannel,
	unlockFeedbackChannel,
	unlockRecoveryConfirmChannel,
	unlockRecoverySecretChannel,
	unlockSubmitChannel,
} from './unlockIpcChannels';

export {
	unlockCancelChannel,
	unlockFeedbackChannel,
	unlockRecoveryConfirmChannel,
	unlockRecoverySecretChannel,
	unlockSubmitChannel,
} from './unlockIpcChannels';

type PendingSubmission = {
	controller: AbortController;
	resolve: (submission: PreProfileUnlockSubmission)=> void;
};

class ElectronPreProfileUnlockView implements PreProfileUnlockView {

	private disposed_ = false;
	private activeAttempt_: AbortController|undefined;
	private pending_: PendingSubmission|undefined;
	private pendingRecoveryConfirmation_: ((confirmation: string|undefined)=> void)|undefined;
	private shown_ = false;
	private windowClosed_ = false;

	private readonly submitListener_ = (
		event: IpcMainEvent,
		submitted: unknown,
	) => {
		const operation = typeof submitted === 'object' && submitted !== null &&
			'operation' in submitted ? submitted.operation : 'unlock';
		const recoverySecret = typeof submitted === 'object' && submitted !== null &&
			'recoverySecret' in submitted ? submitted.recoverySecret : undefined;
		const newPassphrase = typeof submitted === 'object' && submitted !== null &&
			'newPassphrase' in submitted ? submitted.newPassphrase : undefined;
		const currentPassphrase = typeof submitted === 'object' && submitted !== null &&
			'currentPassphrase' in submitted ? submitted.currentPassphrase : undefined;
		const confirmation = typeof submitted === 'object' && submitted !== null &&
			'confirmation' in submitted ? submitted.confirmation : undefined;
		const passphrase = typeof submitted === 'object' && submitted !== null &&
			'passphrase' in submitted ? submitted.passphrase : submitted;
		if (
			event.sender !== this.window_.webContents ||
			(
				operation === 'recover' ?
					typeof recoverySecret !== 'string' || typeof newPassphrase !== 'string' :
					operation === 'changePassphrase' ?
						typeof currentPassphrase !== 'string' || typeof newPassphrase !== 'string' :
						operation === 'retireVault' ?
							typeof passphrase !== 'string' || typeof confirmation !== 'string' :
							(operation !== 'unlock' && operation !== 'create' &&
					operation !== 'replaceRecoverySecret') || typeof passphrase !== 'string'
			) ||
			!this.pending_
		) return;

		const pending = this.pending_;
		this.pending_ = undefined;
		this.activeAttempt_ = pending.controller;
		pending.resolve(operation === 'recover' ? {
			kind: 'submitted',
			operation,
			recoverySecret: recoverySecret as string,
			newPassphrase: newPassphrase as string,
			signal: pending.controller.signal,
		} : operation === 'changePassphrase' ? {
			kind: 'submitted',
			operation,
			currentPassphrase: currentPassphrase as string,
			newPassphrase: newPassphrase as string,
			signal: pending.controller.signal,
		} : operation === 'retireVault' ? {
			kind: 'submitted',
			operation,
			passphrase: passphrase as string,
			confirmation: confirmation as string,
			signal: pending.controller.signal,
		} : {
			kind: 'submitted',
			operation: operation as 'unlock'|'create'|'replaceRecoverySecret',
			passphrase: passphrase as string,
			signal: pending.controller.signal,
		});
	};

	private readonly recoveryConfirmationListener_ = (
		event: IpcMainEvent,
		confirmation: unknown,
	) => {
		if (
			event.sender !== this.window_.webContents ||
			typeof confirmation !== 'string' ||
			!this.pendingRecoveryConfirmation_
		) return;
		const resolve = this.pendingRecoveryConfirmation_;
		this.pendingRecoveryConfirmation_ = undefined;
		resolve(confirmation);
	};

	private readonly cancelListener_ = (event: IpcMainEvent) => {
		if (event.sender !== this.window_.webContents) return;
		this.resolveCancellation_();
	};

	public constructor(
		private readonly unlockSession_: Session,
		private readonly window_: BrowserWindow,
	) {
		ipcMain.on(unlockSubmitChannel, this.submitListener_);
		ipcMain.on(unlockCancelChannel, this.cancelListener_);
		ipcMain.on(unlockRecoveryConfirmChannel, this.recoveryConfirmationListener_);
		this.window_.on('closed', () => {
			this.windowClosed_ = true;
			this.resolveCancellation_();
		});
	}

	private resolveCancellation_() {
		const pending = this.pending_;
		this.pending_ = undefined;
		pending?.controller.abort();
		pending?.resolve({ kind: 'cancelled' });
		this.activeAttempt_?.abort();
		this.pendingRecoveryConfirmation_?.(undefined);
		this.pendingRecoveryConfirmation_ = undefined;
	}

	public confirmRecoverySecret(
		recoverySecret: string,
		purpose: 'create'|'replace' = 'create',
	): Promise<string|undefined> {
		if (this.disposed_ || this.windowClosed_) {
			throw new Error('Pre-profile unlock view is closed');
		}
		if (this.pendingRecoveryConfirmation_) {
			throw new Error('Recovery Secret confirmation is already pending');
		}
		this.window_.webContents.send(unlockRecoverySecretChannel, recoverySecret, purpose);
		return new Promise(resolve => {
			this.pendingRecoveryConfirmation_ = resolve;
		});
	}

	public requestPassphrase(
		feedback?: PreProfileUnlockFeedback,
	): Promise<PreProfileUnlockSubmission> {
		if (this.disposed_ || this.windowClosed_) {
			throw new Error('Pre-profile unlock view is closed');
		}
		if (this.pending_) throw new Error('A passphrase request is already pending');
		if (feedback) this.window_.webContents.send(unlockFeedbackChannel, feedback);

		this.activeAttempt_ = undefined;
		const submission = new Promise<PreProfileUnlockSubmission>(resolve => {
			this.pending_ = {
				controller: new AbortController(),
				resolve,
			};
		});
		if (!this.shown_) {
			this.shown_ = true;
			this.window_.show();
		}
		return submission;
	}

	public async close(): Promise<void> {
		if (this.disposed_) return;
		this.disposed_ = true;
		this.resolveCancellation_();
		ipcMain.removeListener(unlockSubmitChannel, this.submitListener_);
		ipcMain.removeListener(unlockCancelChannel, this.cancelListener_);
		ipcMain.removeListener(unlockRecoveryConfirmChannel, this.recoveryConfirmationListener_);
		if (!this.windowClosed_) this.window_.destroy();

		const cleanupErrors: unknown[] = [];
		for (const cleanup of [
			() => this.unlockSession_.closeAllConnections(),
			() => this.unlockSession_.clearStorageData(),
			() => this.unlockSession_.clearCache(),
		]) {
			try {
				await cleanup();
			} catch (error) {
				cleanupErrors.push(error);
			}
		}
		if (cleanupErrors.length) {
			throw new Error('Pre-profile Electron session cleanup failed');
		}
	}
}

const createElectronPreProfileUnlockView = async (
	assetDirectory: string,
): Promise<PreProfileUnlockView> => {
	const unlockSession = electronSession.fromPartition(
		`watchtower-pre-unlock-${randomUUID()}`,
		{ cache: false },
	);
	if (unlockSession.storagePath !== null) {
		throw new Error('Pre-profile Electron session is not memory-only');
	}
	const assetUrlPrefix = pathToFileURL(`${resolve(assetDirectory)}${sep}`).href;
	unlockSession.webRequest.onBeforeRequest((details, callback) => {
		callback({ cancel: !details.url.startsWith(assetUrlPrefix) });
	});
	unlockSession.setPermissionCheckHandler(() => false);
	unlockSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
		callback(false);
	});

	const window = new BrowserWindow({
		width: 460,
		height: 560,
		resizable: false,
		show: false,
		title: 'Unlock Watchtower One',
		webPreferences: {
			allowRunningInsecureContent: false,
			contextIsolation: true,
			devTools: false,
			nodeIntegration: false,
			preload: join(assetDirectory, 'preload.bundle.js'),
			sandbox: true,
			session: unlockSession,
			spellcheck: false,
			webviewTag: false,
			webSecurity: true,
		},
	});
	window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
	window.webContents.on('will-navigate', event => event.preventDefault());
	window.webContents.on('will-attach-webview', event => event.preventDefault());
	const view = new ElectronPreProfileUnlockView(unlockSession, window);
	try {
		await window.loadFile(join(assetDirectory, 'index.html'));
		return view;
	} catch (error) {
		await view.close();
		throw error;
	}
};

export default createElectronPreProfileUnlockView;
