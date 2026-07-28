import { readFileSync } from 'fs';
import { join } from 'path';
import {
	unlockCancelChannel,
	unlockFeedbackChannel,
	unlockSubmitChannel,
} from './unlockIpcChannels';

const exposeInMainWorld = jest.fn();
const ipcSend = jest.fn();
const ipcOn = jest.fn();

jest.mock('electron', () => ({
	contextBridge: {
		exposeInMainWorld: exposeInMainWorld,
	},
	ipcRenderer: {
		on: ipcOn,
		send: ipcSend,
	},
}));

interface UnlockApi {
	cancel(): void;
	onFeedback(callback: (feedback: { kind: 'wrongCredential' })=> void): void;
	submit(passphrase: string): void;
}

describe('pre-profile unlock assets', () => {
	beforeEach(() => {
		jest.resetModules();
		exposeInMainWorld.mockClear();
		ipcSend.mockClear();
		ipcOn.mockClear();
		document.body.innerHTML = '';
	});

	test('the preload exposes only the narrow unlock API', () => {
		require('./preload');

		expect(exposeInMainWorld).toHaveBeenCalledTimes(1);
		const [worldName, api] = exposeInMainWorld.mock.calls[0] as [
			string,
			UnlockApi,
		];
		expect(worldName).toBe('watchtowerUnlock');
		expect(Object.keys(api).sort()).toEqual([
			'cancel',
			'onFeedback',
			'submit',
		]);

		api.submit('private atlas words');
		api.cancel();
		expect(ipcSend.mock.calls).toEqual([
			[unlockSubmitChannel, 'private atlas words'],
			[unlockCancelChannel],
		]);

		const feedbackCallback = jest.fn();
		api.onFeedback(feedbackCallback);
		expect(ipcOn).toHaveBeenCalledWith(
			unlockFeedbackChannel,
			expect.any(Function),
		);
		const receiveFeedback = ipcOn.mock.calls[0][1];
		receiveFeedback({}, { kind: 'wrongCredential' });
		expect(feedbackCallback).toHaveBeenCalledWith({
			kind: 'wrongCredential',
		});
	});

	test('the form clears its password field before submission and renders opaque feedback', () => {
		document.body.innerHTML = `
			<form id="unlock-form">
				<input id="passphrase" type="password">
				<p id="error" hidden></p>
				<p id="progress" hidden></p>
				<button id="unlock" type="submit">Unlock</button>
				<button id="cancel" type="button">Cancel</button>
			</form>
		`;
		const submit = jest.fn();
		const cancel = jest.fn();
		let showFeedback: ((feedback: { kind: 'wrongCredential' })=> void)|undefined;
		Object.assign(window, {
			watchtowerUnlock: {
				cancel,
				onFeedback: (callback: typeof showFeedback) => {
					showFeedback = callback;
				},
				submit,
			},
		});
		require('./renderer.js');

		const input = document.querySelector<HTMLInputElement>('#passphrase')!;
		const form = document.querySelector<HTMLFormElement>('#unlock-form')!;
		input.value = 'private atlas words';
		form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

		expect(input.value).toBe('');
		expect(submit).toHaveBeenCalledWith('private atlas words');

		showFeedback!({ kind: 'wrongCredential' });
		const error = document.querySelector<HTMLElement>('#error')!;
		expect(error.hidden).toBe(false);
		expect(error.textContent).toBe('That passphrase did not unlock this vault.');
		expect(document.activeElement).toBe(input);

		input.value = 'another private atlas phrase';
		document.querySelector<HTMLButtonElement>('#cancel')!.click();
		expect(input.value).toBe('');
		expect(cancel).toHaveBeenCalledTimes(1);
	});

	test('the document forbids network content and contains no credential value', () => {
		const html = readFileSync(join(__dirname, 'index.html'), 'utf8');

		expect(html).toContain(
			'default-src \'none\'; script-src \'self\'; style-src \'unsafe-inline\'',
		);
		expect(html).not.toMatch(/value\s*=\s*["'][^"']+["']/i);
		expect(html).not.toMatch(/https?:\/\//i);
	});
});
