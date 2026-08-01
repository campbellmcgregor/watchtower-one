import { contextBridge, ipcRenderer } from 'electron';
import {
	unlockCancelChannel,
	unlockFeedbackChannel,
	unlockRecoveryConfirmChannel,
	unlockRecoverySecretChannel,
	unlockSubmitChannel,
} from './unlockIpcChannels';

export interface WatchtowerUnlockApi {
	cancel(): void;
	confirmRecoverySecret(confirmation: string): void;
	onFeedback(callback: (feedback: { kind: 'wrongCredential'|'passphraseRejected'|'alreadyExists' })=> void): void;
	onRecoverySecret(callback: (recoverySecret: string)=> void): void;
	submit(operation: 'unlock'|'create', passphrase: string): void;
}

const api: WatchtowerUnlockApi = Object.freeze({
	cancel: () => {
		ipcRenderer.send(unlockCancelChannel);
	},
	confirmRecoverySecret: (confirmation: string) => {
		if (typeof confirmation !== 'string') {
			throw new TypeError('Recovery Secret confirmation must be a string');
		}
		ipcRenderer.send(unlockRecoveryConfirmChannel, confirmation);
	},
	onFeedback: (callback: (feedback: { kind: 'wrongCredential'|'passphraseRejected'|'alreadyExists' })=> void) => {
		if (typeof callback !== 'function') {
			throw new TypeError('Unlock feedback callback is required');
		}
		ipcRenderer.on(unlockFeedbackChannel, (_event, feedback: unknown) => {
			if (
				typeof feedback === 'object' &&
				feedback !== null &&
				'kind' in feedback &&
				['wrongCredential', 'passphraseRejected', 'alreadyExists'].includes(String(feedback.kind))
			) {
				callback(Object.freeze({ kind: feedback.kind as 'wrongCredential'|'passphraseRejected'|'alreadyExists' }));
			}
		});
	},
	onRecoverySecret: (callback: (recoverySecret: string)=> void) => {
		if (typeof callback !== 'function') {
			throw new TypeError('Recovery Secret callback is required');
		}
		ipcRenderer.on(unlockRecoverySecretChannel, (_event, recoverySecret: unknown) => {
			if (typeof recoverySecret === 'string') callback(recoverySecret);
		});
	},
	submit: (operation: 'unlock'|'create', passphrase: string) => {
		if ((operation !== 'unlock' && operation !== 'create') || typeof passphrase !== 'string') {
			throw new TypeError('Unlock passphrase must be a string');
		}
		ipcRenderer.send(unlockSubmitChannel, { operation, passphrase });
	},
});

contextBridge.exposeInMainWorld('watchtowerUnlock', api);
