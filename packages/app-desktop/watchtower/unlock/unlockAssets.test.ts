import { readFileSync } from 'fs';
import { join } from 'path';
import {
	unlockCancelChannel,
	unlockFeedbackChannel,
	unlockRecoveryConfirmChannel,
	unlockRecoverySecretChannel,
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
	confirmRecoverySecret(confirmation: string): void;
	onFeedback(callback: (feedback: {
		kind: 'wrongCredential'|'passphraseRejected'|'alreadyExists';
		operation?: 'recover'|'changePassphrase'|'replaceRecoverySecret'|'retireVault';
	})=> void): void;
	onRecoverySecret(callback: (
		recoverySecret: string,
		purpose: 'create'|'replace',
	)=> void): void;
	submit(operation: 'unlock'|'create'|'replaceRecoverySecret', passphrase: string): void;
	submit(operation: 'recover', credentials: {
		recoverySecret: string;
		newPassphrase: string;
	}): void;
	submit(operation: 'changePassphrase', credentials: {
		currentPassphrase: string;
		newPassphrase: string;
	}): void;
	submit(operation: 'retireVault', credentials: {
		passphrase: string;
		confirmation: string;
	}): void;
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
			'confirmRecoverySecret',
			'onFeedback',
			'onRecoverySecret',
			'submit',
		]);

		api.submit('unlock', 'private atlas words');
		api.submit('recover', {
			recoverySecret: 'WT1-RECOVERY-SECRET',
			newPassphrase: 'replacement private atlas words',
		});
		api.submit('changePassphrase', {
			currentPassphrase: 'current private atlas words',
			newPassphrase: 'rotated private atlas words',
		});
		api.submit('replaceRecoverySecret', 'current private atlas words');
		api.submit('retireVault', {
			passphrase: 'current private atlas words',
			confirmation: 'DELETE MY VAULT',
		});
		api.confirmRecoverySecret('WT1-RECOVERY-SECRET');
		api.cancel();
		expect(ipcSend.mock.calls).toEqual([
			[unlockSubmitChannel, {
				operation: 'unlock',
				passphrase: 'private atlas words',
			}],
			[unlockSubmitChannel, {
				operation: 'recover',
				recoverySecret: 'WT1-RECOVERY-SECRET',
				newPassphrase: 'replacement private atlas words',
			}],
			[unlockSubmitChannel, {
				operation: 'changePassphrase',
				currentPassphrase: 'current private atlas words',
				newPassphrase: 'rotated private atlas words',
			}],
			[unlockSubmitChannel, {
				operation: 'replaceRecoverySecret',
				passphrase: 'current private atlas words',
			}],
			[unlockSubmitChannel, {
				operation: 'retireVault',
				passphrase: 'current private atlas words',
				confirmation: 'DELETE MY VAULT',
			}],
			[unlockRecoveryConfirmChannel, 'WT1-RECOVERY-SECRET'],
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
		const recoveryCallback = jest.fn();
		api.onRecoverySecret(recoveryCallback);
		expect(ipcOn).toHaveBeenCalledWith(
			unlockRecoverySecretChannel,
			expect.any(Function),
		);
		const receiveRecoverySecret = ipcOn.mock.calls[1][1];
		receiveRecoverySecret({}, 'WT1-RECOVERY-SECRET', 'replace');
		expect(recoveryCallback).toHaveBeenCalledWith('WT1-RECOVERY-SECRET', 'replace');
	});

	test('the form clears its password field before submission and renders opaque feedback', () => {
		document.body.innerHTML = `
			<form id="unlock-form">
				<input id="passphrase" type="password">
				<p id="error" hidden></p>
				<p id="progress" hidden></p>
				<button id="unlock" type="submit">Unlock</button>
				<button id="create" type="button">Create</button>
				<button id="recover" type="button">Recover</button>
				<button id="change-passphrase" type="button">Change</button>
				<button id="replace-recovery-secret" type="button">Replace recovery</button>
				<button id="retire-vault" type="button">Delete vault</button>
				<button id="cancel" type="button">Cancel</button>
			</form>
			<form id="retire-vault-form" hidden>
				<input id="retire-passphrase" type="password">
				<input id="retire-confirmation">
				<p id="retire-error" hidden></p>
				<p id="retire-progress" hidden></p>
				<button id="retire-back" type="button">Back</button>
				<button id="retire-submit" type="submit">Delete</button>
			</form>
			<form id="replace-recovery-secret-form" hidden>
				<input id="replace-recovery-passphrase" type="password">
				<p id="replace-recovery-error" hidden></p>
				<p id="replace-recovery-progress" hidden></p>
				<button id="replace-recovery-back" type="button">Back</button>
				<button id="replace-recovery-submit" type="submit">Replace</button>
			</form>
			<form id="change-passphrase-form" hidden>
				<input id="current-passphrase" type="password">
				<input id="new-passphrase" type="password">
				<p id="change-passphrase-error" hidden></p>
				<p id="change-passphrase-progress" hidden></p>
				<button id="change-passphrase-back" type="button">Back</button>
				<button id="change-passphrase-submit" type="submit">Change</button>
			</form>
			<form id="recover-form" hidden>
				<input id="recover-secret">
				<input id="recover-passphrase" type="password">
				<p id="recover-error" hidden></p>
				<p id="recover-progress" hidden></p>
				<button id="recover-back" type="button">Back</button>
				<button id="recover-submit" type="submit">Recover</button>
			</form>
			<section id="recovery" hidden>
				<h1 id="recovery-heading">Save your Recovery Secret</h1>
				<code id="recovery-secret"></code>
				<input id="recovery-confirmation">
				<button id="recovery-confirm" type="button">Confirm</button>
				<button id="recovery-cancel" type="button">Cancel</button>
			</section>
		`;
		const submit = jest.fn();
		const cancel = jest.fn();
		const confirmRecoverySecret = jest.fn();
		let showFeedback: ((feedback: {
			kind: 'wrongCredential'|'passphraseRejected'|'alreadyExists';
			operation?: 'recover'|'changePassphrase'|'replaceRecoverySecret'|'retireVault';
		})=> void)|undefined;
		let showRecoverySecret: ((
			recoverySecret: string,
			purpose: 'create'|'replace',
		)=> void)|undefined;
		Object.assign(window, {
			watchtowerUnlock: {
				cancel,
				confirmRecoverySecret,
				onFeedback: (callback: typeof showFeedback) => {
					showFeedback = callback;
				},
				onRecoverySecret: (callback: typeof showRecoverySecret) => {
					showRecoverySecret = callback;
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
		expect(submit).toHaveBeenCalledWith('unlock', 'private atlas words');

		showFeedback!({ kind: 'wrongCredential' });
		const error = document.querySelector<HTMLElement>('#error')!;
		expect(error.hidden).toBe(false);
		expect(error.textContent).toBe('That passphrase did not unlock this vault.');
		expect(document.activeElement).toBe(input);

		document.querySelector<HTMLButtonElement>('#recover')!.click();
		const recoverSecret = document.querySelector<HTMLInputElement>('#recover-secret')!;
		const recoverPassphrase = document.querySelector<HTMLInputElement>('#recover-passphrase')!;
		recoverSecret.value = 'WT1-RECOVERY-SECRET';
		recoverPassphrase.value = 'replacement private atlas words';
		document.querySelector<HTMLFormElement>('#recover-form')!.dispatchEvent(
			new Event('submit', { bubbles: true, cancelable: true }),
		);
		expect(recoverSecret.value).toBe('');
		expect(recoverPassphrase.value).toBe('');
		expect(submit).toHaveBeenLastCalledWith('recover', {
			recoverySecret: 'WT1-RECOVERY-SECRET',
			newPassphrase: 'replacement private atlas words',
		});

		document.querySelector<HTMLButtonElement>('#change-passphrase')!.click();
		const currentPassphrase = document.querySelector<HTMLInputElement>('#current-passphrase')!;
		const newPassphrase = document.querySelector<HTMLInputElement>('#new-passphrase')!;
		currentPassphrase.value = 'current private atlas words';
		newPassphrase.value = 'rotated private atlas words';
		document.querySelector<HTMLFormElement>('#change-passphrase-form')!.dispatchEvent(
			new Event('submit', { bubbles: true, cancelable: true }),
		);
		expect(currentPassphrase.value).toBe('');
		expect(newPassphrase.value).toBe('');
		expect(submit).toHaveBeenLastCalledWith('changePassphrase', {
			currentPassphrase: 'current private atlas words',
			newPassphrase: 'rotated private atlas words',
		});

		document.querySelector<HTMLButtonElement>('#replace-recovery-secret')!.click();
		const replaceRecoveryPassphrase = document.querySelector<HTMLInputElement>(
			'#replace-recovery-passphrase',
		)!;
		replaceRecoveryPassphrase.value = 'current private atlas words';
		document.querySelector<HTMLFormElement>('#replace-recovery-secret-form')!.dispatchEvent(
			new Event('submit', { bubbles: true, cancelable: true }),
		);
		expect(replaceRecoveryPassphrase.value).toBe('');
		expect(submit).toHaveBeenLastCalledWith(
			'replaceRecoverySecret',
			'current private atlas words',
		);

		document.querySelector<HTMLButtonElement>('#retire-vault')!.click();
		const retirePassphrase = document.querySelector<HTMLInputElement>(
			'#retire-passphrase',
		)!;
		const retireConfirmation = document.querySelector<HTMLInputElement>(
			'#retire-confirmation',
		)!;
		retirePassphrase.value = 'current private atlas words';
		retireConfirmation.value = 'DELETE MY VAULT';
		document.querySelector<HTMLFormElement>('#retire-vault-form')!.dispatchEvent(
			new Event('submit', { bubbles: true, cancelable: true }),
		);
		expect(retirePassphrase.value).toBe('');
		expect(retireConfirmation.value).toBe('');
		expect(submit).toHaveBeenLastCalledWith('retireVault', {
			passphrase: 'current private atlas words',
			confirmation: 'DELETE MY VAULT',
		});
		showFeedback!({ kind: 'wrongCredential', operation: 'retireVault' });
		expect(document.querySelector<HTMLElement>('#retire-vault-form')!.hidden).toBe(false);
		expect(document.querySelector<HTMLElement>('#retire-error')!.textContent).toBe(
			'That passphrase or confirmation did not authorize vault deletion.',
		);

		showRecoverySecret!('WT1-RECOVERY-SECRET', 'replace');
		expect(document.querySelector<HTMLElement>('#recovery')!.hidden).toBe(false);
		expect(document.querySelector('#recovery-heading')!.textContent).toBe(
			'Save your replacement Recovery Secret',
		);
		expect(document.querySelector('#recovery-confirm')!.textContent).toBe(
			'Replace Recovery Secret',
		);
		expect(document.querySelector('#recovery-secret')!.textContent).toBe(
			'WT1-RECOVERY-SECRET',
		);
		const recoveryInput = document.querySelector<HTMLInputElement>('#recovery-confirmation')!;
		recoveryInput.value = 'WT1-RECOVERY-SECRET';
		document.querySelector<HTMLButtonElement>('#recovery-confirm')!.click();
		expect(recoveryInput.value).toBe('');
		expect(confirmRecoverySecret).toHaveBeenCalledWith('WT1-RECOVERY-SECRET');

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
