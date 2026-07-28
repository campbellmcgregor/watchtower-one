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
	unlockSubmitChannel,
} from './unlockIpcChannels';

export {
	unlockCancelChannel,
	unlockFeedbackChannel,
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
	private shown_ = false;
	private windowClosed_ = false;

	private readonly submitListener_ = (
		event: IpcMainEvent,
		passphrase: unknown,
	) => {
		if (
			event.sender !== this.window_.webContents ||
			typeof passphrase !== 'string' ||
			!this.pending_
		) return;

		const pending = this.pending_;
		this.pending_ = undefined;
		this.activeAttempt_ = pending.controller;
		pending.resolve({
			kind: 'submitted',
			passphrase,
			signal: pending.controller.signal,
		});
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
		height: 360,
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
