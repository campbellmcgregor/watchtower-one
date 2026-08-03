import { EventEmitter } from 'events';
import { join } from 'path';
import { pathToFileURL } from 'url';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Electron listener arguments are the mocked system boundary.
type Listener = (...args: any[])=> void;

interface ElectronHarness {
	browserWindowOptions: Record<string, unknown>[];
	ipcMain: EventEmitter;
	session: {
		clearCache: jest.Mock<Promise<void>, []>;
		clearStorageData: jest.Mock<Promise<void>, []>;
		closeAllConnections: jest.Mock<Promise<void>, []>;
		setPermissionCheckHandler: jest.Mock;
		setPermissionRequestHandler: jest.Mock;
		storagePath: null;
		webRequest: {
			onBeforeRequest: jest.Mock;
		};
	};
	sessionRequests: {
		partition: string;
		options: { cache: false };
	}[];
	windows: (EventEmitter & {
		destroy: jest.Mock;
		loadFile: jest.Mock<Promise<void>, [string]>;
		show: jest.Mock;
		webContents: EventEmitter & {
			send: jest.Mock;
			setWindowOpenHandler: jest.Mock;
		};
	})[];
	reset(): void;
}

jest.mock('electron', () => {
	const { EventEmitter: MockEventEmitter } = require('events');
	const harness: ElectronHarness = {
		browserWindowOptions: [],
		ipcMain: new MockEventEmitter(),
		session: {
			clearCache: jest.fn(async () => {}),
			clearStorageData: jest.fn(async () => {}),
			closeAllConnections: jest.fn(async () => {}),
			setPermissionCheckHandler: jest.fn(),
			setPermissionRequestHandler: jest.fn(),
			storagePath: null,
			webRequest: {
				onBeforeRequest: jest.fn(),
			},
		},
		sessionRequests: [],
		windows: [],
		reset() {
			this.browserWindowOptions.length = 0;
			this.ipcMain.removeAllListeners();
			this.session.clearCache.mockClear();
			this.session.clearStorageData.mockClear();
			this.session.closeAllConnections.mockClear();
			this.session.setPermissionCheckHandler.mockClear();
			this.session.setPermissionRequestHandler.mockClear();
			this.session.webRequest.onBeforeRequest.mockClear();
			this.sessionRequests.length = 0;
			this.windows.length = 0;
		},
	};

	return {
		__harness: harness,
		BrowserWindow: function(options: Record<string, unknown>) {
			const window = new MockEventEmitter();
			const webContents = new MockEventEmitter();
			Object.assign(webContents, {
				send: jest.fn(),
				setWindowOpenHandler: jest.fn(),
			});
			Object.assign(window, {
				destroy: jest.fn(),
				loadFile: jest.fn(async () => {}),
				show: jest.fn(),
				webContents,
			});
			harness.browserWindowOptions.push(options);
			harness.windows.push(window);
			return window;
		},
		ipcMain: {
			on: (channel: string, listener: Listener) => {
				harness.ipcMain.on(channel, listener);
			},
			removeListener: (channel: string, listener: Listener) => {
				harness.ipcMain.removeListener(channel, listener);
			},
		},
		session: {
			fromPartition: (
				partition: string,
				options: { cache: false },
			) => {
				harness.sessionRequests.push({ partition, options });
				return harness.session;
			},
		},
	};
});

import createElectronPreProfileUnlockView, {
	unlockCancelChannel,
	unlockFeedbackChannel,
	unlockRecoveryConfirmChannel,
	unlockRecoverySecretChannel,
	unlockSubmitChannel,
} from './ElectronPreProfileUnlockView';

const electronHarness = (
	jest.requireMock('electron') as { __harness: ElectronHarness }
).__harness;

describe('ElectronPreProfileUnlockView', () => {
	beforeEach(() => {
		electronHarness.reset();
	});

	test('collects a passphrase through an isolated memory-only Electron window', async () => {
		const assetDirectory = 'C:\\WatchtowerApplication\\unlock';
		const view = await createElectronPreProfileUnlockView(assetDirectory);
		const window = electronHarness.windows[0];
		expect(window.show).not.toHaveBeenCalled();
		const submissionPromise = view.requestPassphrase();
		await Promise.resolve();
		expect(window.show).toHaveBeenCalledTimes(1);

		expect(electronHarness.sessionRequests).toHaveLength(1);
		expect(electronHarness.sessionRequests[0]).toEqual({
			partition: expect.stringMatching(/^watchtower-pre-unlock-/),
			options: { cache: false },
		});
		expect(electronHarness.browserWindowOptions).toEqual([expect.objectContaining({
			show: false,
			webPreferences: expect.objectContaining({
				contextIsolation: true,
				devTools: false,
				nodeIntegration: false,
				sandbox: true,
				session: electronHarness.session,
				webSecurity: true,
				preload: join(assetDirectory, 'preload.bundle.js'),
			}),
		})]);

		expect(window.loadFile).toHaveBeenCalledWith(join(assetDirectory, 'index.html'));

		electronHarness.ipcMain.emit(
			unlockSubmitChannel,
			{ sender: new EventEmitter() },
			'foreign private atlas words',
		);
		electronHarness.ipcMain.emit(
			unlockSubmitChannel,
			{ sender: window.webContents },
			'correct private atlas words',
		);

		await expect(submissionPromise).resolves.toEqual({
			kind: 'submitted',
			operation: 'unlock',
			passphrase: 'correct private atlas words',
			signal: expect.any(AbortSignal),
		});

		await view.close();
		expect(window.destroy).toHaveBeenCalledTimes(1);
		expect(electronHarness.session.clearCache).toHaveBeenCalledTimes(1);
		expect(electronHarness.session.clearStorageData).toHaveBeenCalledTimes(1);
		expect(electronHarness.session.closeAllConnections).toHaveBeenCalledTimes(1);
	});

	test('cancels an active submitted unlock attempt', async () => {
		const view = await createElectronPreProfileUnlockView(
			'C:\\WatchtowerApplication\\unlock',
		);
		const window = electronHarness.windows[0];
		const submissionPromise = view.requestPassphrase();
		electronHarness.ipcMain.emit(
			unlockSubmitChannel,
			{ sender: window.webContents },
			'private atlas words',
		);
		const submission = await submissionPromise;
		if (submission.kind !== 'submitted') {
			throw new Error('Expected an unlock submission');
		}

		expect(submission.signal.aborted).toBe(false);
		electronHarness.ipcMain.emit(
			unlockCancelChannel,
			{ sender: window.webContents },
		);
		expect(submission.signal.aborted).toBe(true);

		await view.close();
	});

	test('collects a Recovery Secret and replacement passphrase without accepting foreign IPC', async () => {
		const view = await createElectronPreProfileUnlockView(
			'C:\\WatchtowerApplication\\unlock',
		);
		const window = electronHarness.windows[0];
		const submissionPromise = view.requestPassphrase();
		const recoverySubmission = {
			operation: 'recover',
			recoverySecret: 'WT1-RECOVERY-SECRET',
			newPassphrase: 'replacement private atlas words',
		};
		electronHarness.ipcMain.emit(
			unlockSubmitChannel,
			{ sender: new EventEmitter() },
			recoverySubmission,
		);
		electronHarness.ipcMain.emit(
			unlockSubmitChannel,
			{ sender: window.webContents },
			recoverySubmission,
		);

		await expect(submissionPromise).resolves.toEqual({
			kind: 'submitted',
			operation: 'recover',
			recoverySecret: 'WT1-RECOVERY-SECRET',
			newPassphrase: 'replacement private atlas words',
			signal: expect.any(AbortSignal),
		});
		await view.close();
	});

	test('collects current and replacement passphrases for one rotation attempt', async () => {
		const view = await createElectronPreProfileUnlockView(
			'C:\\WatchtowerApplication\\unlock',
		);
		const window = electronHarness.windows[0];
		const submissionPromise = view.requestPassphrase();
		electronHarness.ipcMain.emit(
			unlockSubmitChannel,
			{ sender: window.webContents },
			{
				operation: 'changePassphrase',
				currentPassphrase: 'current private atlas words',
				newPassphrase: 'replacement private atlas words',
			},
		);

		await expect(submissionPromise).resolves.toEqual({
			kind: 'submitted',
			operation: 'changePassphrase',
			currentPassphrase: 'current private atlas words',
			newPassphrase: 'replacement private atlas words',
			signal: expect.any(AbortSignal),
		});
		await view.close();
	});

	test('shows and authenticates first-run Recovery Secret confirmation', async () => {
		const view = await createElectronPreProfileUnlockView(
			'C:\\WatchtowerApplication\\unlock',
		);
		const window = electronHarness.windows[0];
		const confirmation = view.confirmRecoverySecret!(
			'WT1-RECOVERY-SECRET',
		);
		expect(window.webContents.send).toHaveBeenCalledWith(
			unlockRecoverySecretChannel,
			'WT1-RECOVERY-SECRET',
		);
		electronHarness.ipcMain.emit(
			unlockRecoveryConfirmChannel,
			{ sender: new EventEmitter() },
			'foreign-secret',
		);
		electronHarness.ipcMain.emit(
			unlockRecoveryConfirmChannel,
			{ sender: window.webContents },
			'WT1-RECOVERY-SECRET',
		);
		await expect(confirmation).resolves.toBe('WT1-RECOVERY-SECRET');
		await view.close();
	});

	test('authenticates unlock IPC before the page can become interactive', async () => {
		const creatingView = createElectronPreProfileUnlockView(
			'C:\\WatchtowerApplication\\unlock',
		);

		expect(electronHarness.ipcMain.listenerCount(unlockSubmitChannel)).toBe(1);

		const view = await creatingView;
		await view.close();
	});

	test('reports wrong credentials opaquely and treats a closed window as cancellation', async () => {
		const view = await createElectronPreProfileUnlockView(
			'C:\\WatchtowerApplication\\unlock',
		);
		const window = electronHarness.windows[0];
		const firstRequest = view.requestPassphrase();
		electronHarness.ipcMain.emit(
			unlockSubmitChannel,
			{ sender: window.webContents },
			'wrong private atlas words',
		);
		await firstRequest;

		const retry = view.requestPassphrase({ kind: 'wrongCredential' });
		expect(window.webContents.send).toHaveBeenCalledWith(
			unlockFeedbackChannel,
			{ kind: 'wrongCredential' },
		);
		window.emit('closed');
		await expect(retry).resolves.toEqual({ kind: 'cancelled' });

		await view.close();
		expect(electronHarness.ipcMain.listenerCount(unlockSubmitChannel)).toBe(0);
		expect(electronHarness.session.clearStorageData).toHaveBeenCalledTimes(1);
	});

	test('denies navigation, child windows, network requests, and permissions', async () => {
		const assetDirectory = 'C:\\WatchtowerApplication\\unlock';
		const view = await createElectronPreProfileUnlockView(assetDirectory);
		const window = electronHarness.windows[0];

		const openWindow = window.webContents.setWindowOpenHandler.mock.calls[0][0];
		expect(openWindow({ url: 'https://attacker.invalid' })).toEqual({
			action: 'deny',
		});

		for (const eventName of ['will-navigate', 'will-attach-webview']) {
			const event = { preventDefault: jest.fn() };
			window.webContents.emit(eventName, event);
			expect(event.preventDefault).toHaveBeenCalledTimes(1);
		}

		const filterNetworkRequest =
			electronHarness.session.webRequest.onBeforeRequest.mock.calls[0][0];
		const fileCallback = jest.fn();
		filterNetworkRequest(
			{ url: pathToFileURL(join(assetDirectory, 'index.html')).href },
			fileCallback,
		);
		expect(fileCallback).toHaveBeenCalledWith({ cancel: false });
		const networkCallback = jest.fn();
		filterNetworkRequest(
			{ url: 'https://attacker.invalid/collect' },
			networkCallback,
		);
		expect(networkCallback).toHaveBeenCalledWith({ cancel: true });

		const checkPermission =
			electronHarness.session.setPermissionCheckHandler.mock.calls[0][0];
		expect(checkPermission()).toBe(false);
		const requestPermission =
			electronHarness.session.setPermissionRequestHandler.mock.calls[0][0];
		const permissionCallback = jest.fn();
		requestPermission(window.webContents, 'clipboard-read', permissionCallback);
		expect(permissionCallback).toHaveBeenCalledWith(false);

		await view.close();
	});
});
