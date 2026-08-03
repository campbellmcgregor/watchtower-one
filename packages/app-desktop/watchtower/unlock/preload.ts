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
	onFeedback(callback: (feedback: {
		kind: 'wrongCredential'|'passphraseRejected'|'alreadyExists';
		operation?: 'recover'|'changePassphrase'|'replaceRecoverySecret';
	})=> void): void;
	onRecoverySecret(callback: (
		recoverySecret: string,
		purpose: 'create'|'replace',
	)=> void): void;
	submit(
		operation: 'unlock'|'create',
		credential: string,
	): void;
	submit(
		operation: 'recover',
		credential: { recoverySecret: string; newPassphrase: string },
	): void;
	submit(
		operation: 'changePassphrase',
		credential: { currentPassphrase: string; newPassphrase: string },
	): void;
	submit(operation: 'replaceRecoverySecret', credential: string): void;
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
	onFeedback: (callback: (feedback: {
		kind: 'wrongCredential'|'passphraseRejected'|'alreadyExists';
		operation?: 'recover'|'changePassphrase'|'replaceRecoverySecret';
	})=> void) => {
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
				callback(Object.freeze({
					kind: feedback.kind as 'wrongCredential'|'passphraseRejected'|'alreadyExists',
					...('operation' in feedback &&
						(feedback.operation === 'recover' ||
						feedback.operation === 'changePassphrase' ||
						feedback.operation === 'replaceRecoverySecret') ?
						{ operation: feedback.operation } : {}),
				}));
			}
		});
	},
	onRecoverySecret: (callback: (
		recoverySecret: string,
		purpose: 'create'|'replace',
	)=> void) => {
		if (typeof callback !== 'function') {
			throw new TypeError('Recovery Secret callback is required');
		}
		ipcRenderer.on(unlockRecoverySecretChannel, (
			_event,
			recoverySecret: unknown,
			purpose: unknown,
		) => {
			if (
				typeof recoverySecret === 'string' &&
				(purpose === 'create' || purpose === 'replace')
			) callback(recoverySecret, purpose);
		});
	},
	submit: (
		operation: 'unlock'|'create'|'recover'|'changePassphrase'|'replaceRecoverySecret',
		credential: string|{ recoverySecret: string; newPassphrase: string }|
		{ currentPassphrase: string; newPassphrase: string },
	) => {
		if (operation === 'recover') {
			if (
				typeof credential !== 'object' || credential === null ||
				!('recoverySecret' in credential) ||
				typeof credential.recoverySecret !== 'string' ||
				typeof credential.newPassphrase !== 'string'
			) {
				throw new TypeError('Recovery credentials must be strings');
			}
			ipcRenderer.send(unlockSubmitChannel, { operation, ...credential });
			return;
		}
		if (operation === 'changePassphrase') {
			if (
				typeof credential !== 'object' || credential === null ||
				!('currentPassphrase' in credential) ||
				typeof credential.currentPassphrase !== 'string' ||
				typeof credential.newPassphrase !== 'string'
			) {
				throw new TypeError('Passphrase rotation credentials must be strings');
			}
			ipcRenderer.send(unlockSubmitChannel, { operation, ...credential });
			return;
		}
		if (
			(operation !== 'unlock' && operation !== 'create' &&
			operation !== 'replaceRecoverySecret') || typeof credential !== 'string'
		) {
			throw new TypeError('Unlock passphrase must be a string');
		}
		ipcRenderer.send(unlockSubmitChannel, { operation, passphrase: credential });
	},
});

contextBridge.exposeInMainWorld('watchtowerUnlock', api);
