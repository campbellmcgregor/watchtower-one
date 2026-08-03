'use strict';

(() => {
	const api = window.watchtowerUnlock;
	const form = document.querySelector('#unlock-form');
	const input = document.querySelector('#passphrase');
	const error = document.querySelector('#error');
	const unlock = document.querySelector('#unlock');
	const create = document.querySelector('#create');
	const recover = document.querySelector('#recover');
	const changePassphrase = document.querySelector('#change-passphrase');
	const cancel = document.querySelector('#cancel');
	const progress = document.querySelector('#progress');
	const recovery = document.querySelector('#recovery');
	const recoverySecret = document.querySelector('#recovery-secret');
	const recoveryConfirmation = document.querySelector('#recovery-confirmation');
	const recoveryConfirm = document.querySelector('#recovery-confirm');
	const recoveryCancel = document.querySelector('#recovery-cancel');
	const recoverForm = document.querySelector('#recover-form');
	const recoverSecret = document.querySelector('#recover-secret');
	const recoverPassphrase = document.querySelector('#recover-passphrase');
	const recoverBack = document.querySelector('#recover-back');
	const recoverSubmit = document.querySelector('#recover-submit');
	const recoverError = document.querySelector('#recover-error');
	const recoverProgress = document.querySelector('#recover-progress');
	const changePassphraseForm = document.querySelector('#change-passphrase-form');
	const currentPassphrase = document.querySelector('#current-passphrase');
	const newPassphrase = document.querySelector('#new-passphrase');
	const changePassphraseBack = document.querySelector('#change-passphrase-back');
	const changePassphraseSubmit = document.querySelector('#change-passphrase-submit');
	const changePassphraseError = document.querySelector('#change-passphrase-error');
	const changePassphraseProgress = document.querySelector('#change-passphrase-progress');
	const focus = element => {
		// This pre-profile asset cannot import Joplin's profile-bearing focus helper.
		// eslint-disable-next-line no-restricted-properties
		element.focus();
	};

	const setBusy = busy => {
		input.disabled = busy;
		unlock.disabled = busy;
		create.disabled = busy;
		recover.disabled = busy;
		changePassphrase.disabled = busy;
		recoverSecret.disabled = busy;
		recoverPassphrase.disabled = busy;
		recoverSubmit.disabled = busy;
		currentPassphrase.disabled = busy;
		newPassphrase.disabled = busy;
		changePassphraseSubmit.disabled = busy;
		progress.hidden = !busy;
		recoverProgress.hidden = !busy;
		changePassphraseProgress.hidden = !busy;
	};

	const showRecoveryForm = () => {
		form.hidden = true;
		recovery.hidden = true;
		recoverForm.hidden = false;
		changePassphraseForm.hidden = true;
		error.hidden = true;
		recoverError.hidden = true;
		setBusy(false);
		focus(recoverSecret);
	};

	const showChangePassphraseForm = () => {
		form.hidden = true;
		recovery.hidden = true;
		recoverForm.hidden = true;
		changePassphraseForm.hidden = false;
		error.hidden = true;
		changePassphraseError.hidden = true;
		setBusy(false);
		focus(currentPassphrase);
	};

	const submit = operation => {
		const passphrase = input.value;
		input.value = '';
		error.hidden = true;
		setBusy(true);
		api.submit(operation, passphrase);
	};

	form.addEventListener('submit', event => {
		event.preventDefault();
		submit('unlock');
	});

	create.addEventListener('click', () => submit('create'));
	recover.addEventListener('click', showRecoveryForm);
	changePassphrase.addEventListener('click', showChangePassphraseForm);
	recoverBack.addEventListener('click', () => {
		recoverSecret.value = '';
		recoverPassphrase.value = '';
		recoverForm.hidden = true;
		form.hidden = false;
		focus(input);
	});
	changePassphraseBack.addEventListener('click', () => {
		currentPassphrase.value = '';
		newPassphrase.value = '';
		changePassphraseForm.hidden = true;
		form.hidden = false;
		focus(input);
	});
	changePassphraseForm.addEventListener('submit', event => {
		event.preventDefault();
		const currentPassphraseValue = currentPassphrase.value;
		const newPassphraseValue = newPassphrase.value;
		currentPassphrase.value = '';
		newPassphrase.value = '';
		setBusy(true);
		api.submit('changePassphrase', {
			currentPassphrase: currentPassphraseValue,
			newPassphrase: newPassphraseValue,
		});
	});
	recoverForm.addEventListener('submit', event => {
		event.preventDefault();
		const recoverySecretValue = recoverSecret.value;
		const newPassphrase = recoverPassphrase.value;
		recoverSecret.value = '';
		recoverPassphrase.value = '';
		setBusy(true);
		api.submit('recover', {
			recoverySecret: recoverySecretValue,
			newPassphrase,
		});
	});

	cancel.addEventListener('click', () => {
		input.value = '';
		recoverSecret.value = '';
		recoverPassphrase.value = '';
		currentPassphrase.value = '';
		newPassphrase.value = '';
		recoveryConfirmation.value = '';
		api.cancel();
	});
	recoveryCancel.addEventListener('click', () => api.cancel());
	recoveryConfirm.addEventListener('click', () => {
		const confirmation = recoveryConfirmation.value;
		recoveryConfirmation.value = '';
		api.confirmRecoverySecret(confirmation);
	});

	api.onFeedback(feedback => {
		setBusy(false);
		form.hidden = feedback.operation === 'recover' ||
			feedback.operation === 'changePassphrase';
		recoverForm.hidden = feedback.operation !== 'recover';
		changePassphraseForm.hidden = feedback.operation !== 'changePassphrase';
		recovery.hidden = true;
		recoverySecret.textContent = '';
		error.textContent = feedback.kind === 'passphraseRejected' ?
			'Choose a stronger, less commonly used passphrase.' :
			feedback.kind === 'alreadyExists' ?
				'A vault already exists. Unlock it instead.' :
				'That passphrase did not unlock this vault.';
		error.hidden = false;
		if (feedback.operation === 'recover') {
			recoverError.textContent = feedback.kind === 'passphraseRejected' ?
				'Choose a stronger, less commonly used passphrase.' :
				'That Recovery Secret did not unlock this vault.';
			recoverError.hidden = false;
			error.hidden = true;
		}
		if (feedback.operation === 'changePassphrase') {
			changePassphraseError.textContent = feedback.kind === 'passphraseRejected' ?
				'Choose a stronger, less commonly used passphrase.' :
				'That current passphrase did not unlock this vault.';
			changePassphraseError.hidden = false;
			error.hidden = true;
		}
		focus(feedback.operation === 'recover' ? recoverSecret :
			feedback.operation === 'changePassphrase' ? currentPassphrase : input);
	});

	api.onRecoverySecret(secret => {
		form.hidden = true;
		recoverForm.hidden = true;
		changePassphraseForm.hidden = true;
		recovery.hidden = false;
		recoverySecret.textContent = secret;
		focus(recoveryConfirmation);
	});
})();
