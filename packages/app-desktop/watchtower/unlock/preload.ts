import { contextBridge, ipcRenderer } from 'electron';
import {
	unlockCancelChannel,
	unlockFeedbackChannel,
	unlockSubmitChannel,
} from './unlockIpcChannels';

export interface WatchtowerUnlockApi {
	cancel(): void;
	onFeedback(callback: (feedback: { kind: 'wrongCredential' })=> void): void;
	submit(passphrase: string): void;
}

const api: WatchtowerUnlockApi = Object.freeze({
	cancel: () => {
		ipcRenderer.send(unlockCancelChannel);
	},
	onFeedback: (callback: (feedback: { kind: 'wrongCredential' })=> void) => {
		if (typeof callback !== 'function') {
			throw new TypeError('Unlock feedback callback is required');
		}
		ipcRenderer.on(unlockFeedbackChannel, (_event, feedback: unknown) => {
			if (
				typeof feedback === 'object' &&
				feedback !== null &&
				'kind' in feedback &&
				feedback.kind === 'wrongCredential'
			) {
				callback(Object.freeze({ kind: 'wrongCredential' }));
			}
		});
	},
	submit: (passphrase: string) => {
		if (typeof passphrase !== 'string') {
			throw new TypeError('Unlock passphrase must be a string');
		}
		ipcRenderer.send(unlockSubmitChannel, passphrase);
	},
});

contextBridge.exposeInMainWorld('watchtowerUnlock', api);
