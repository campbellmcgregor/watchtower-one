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
	const replaceRecoverySecret = document.querySelector('#replace-recovery-secret');
	const retireVault = document.querySelector('#retire-vault');
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
	const replaceRecoverySecretForm = document.querySelector('#replace-recovery-secret-form');
	const replaceRecoveryPassphrase = document.querySelector('#replace-recovery-passphrase');
	const replaceRecoveryBack = document.querySelector('#replace-recovery-back');
	const replaceRecoverySubmit = document.querySelector('#replace-recovery-submit');
	const replaceRecoveryError = document.querySelector('#replace-recovery-error');
	const replaceRecoveryProgress = document.querySelector('#replace-recovery-progress');
	const retireVaultForm = document.querySelector('#retire-vault-form');
	const retirePassphrase = document.querySelector('#retire-passphrase');
	const retireConfirmation = document.querySelector('#retire-confirmation');
	const retireBack = document.querySelector('#retire-back');
	const retireSubmit = document.querySelector('#retire-submit');
	const retireError = document.querySelector('#retire-error');
	const retireProgress = document.querySelector('#retire-progress');
	const recoveryHeading = document.querySelector('#recovery-heading');
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
		replaceRecoverySecret.disabled = busy;
		retireVault.disabled = busy;
		recoverSecret.disabled = busy;
		recoverPassphrase.disabled = busy;
		recoverSubmit.disabled = busy;
		currentPassphrase.disabled = busy;
		newPassphrase.disabled = busy;
		changePassphraseSubmit.disabled = busy;
		replaceRecoveryPassphrase.disabled = busy;
		replaceRecoverySubmit.disabled = busy;
		retirePassphrase.disabled = busy;
		retireConfirmation.disabled = busy;
		retireSubmit.disabled = busy;
		progress.hidden = !busy;
		recoverProgress.hidden = !busy;
		changePassphraseProgress.hidden = !busy;
		replaceRecoveryProgress.hidden = !busy;
		retireProgress.hidden = !busy;
	};

	const showRecoveryForm = () => {
		form.hidden = true;
		recovery.hidden = true;
		recoverForm.hidden = false;
		changePassphraseForm.hidden = true;
		replaceRecoverySecretForm.hidden = true;
		retireVaultForm.hidden = true;
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
		replaceRecoverySecretForm.hidden = true;
		retireVaultForm.hidden = true;
		error.hidden = true;
		changePassphraseError.hidden = true;
		setBusy(false);
		focus(currentPassphrase);
	};

	const showReplaceRecoverySecretForm = () => {
		form.hidden = true;
		recovery.hidden = true;
		recoverForm.hidden = true;
		changePassphraseForm.hidden = true;
		replaceRecoverySecretForm.hidden = false;
		retireVaultForm.hidden = true;
		error.hidden = true;
		replaceRecoveryError.hidden = true;
		setBusy(false);
		focus(replaceRecoveryPassphrase);
	};

	const showRetireVaultForm = () => {
		form.hidden = true;
		recovery.hidden = true;
		recoverForm.hidden = true;
		changePassphraseForm.hidden = true;
		replaceRecoverySecretForm.hidden = true;
		retireVaultForm.hidden = false;
		error.hidden = true;
		retireError.hidden = true;
		setBusy(false);
		focus(retirePassphrase);
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
	replaceRecoverySecret.addEventListener('click', showReplaceRecoverySecretForm);
	retireVault.addEventListener('click', showRetireVaultForm);
	recoverBack.addEventListener('click', () => {
		recoverSecret.value = '';
		recoverPassphrase.value = '';
		recoverForm.hidden = true;
		form.hidden = false;
		focus(input);
	});
	replaceRecoveryBack.addEventListener('click', () => {
		replaceRecoveryPassphrase.value = '';
		replaceRecoverySecretForm.hidden = true;
		form.hidden = false;
		focus(input);
	});
	replaceRecoverySecretForm.addEventListener('submit', event => {
		event.preventDefault();
		const passphrase = replaceRecoveryPassphrase.value;
		replaceRecoveryPassphrase.value = '';
		setBusy(true);
		api.submit('replaceRecoverySecret', passphrase);
	});
	retireBack.addEventListener('click', () => {
		retirePassphrase.value = '';
		retireConfirmation.value = '';
		retireVaultForm.hidden = true;
		form.hidden = false;
		focus(input);
	});
	retireVaultForm.addEventListener('submit', event => {
		event.preventDefault();
		const passphrase = retirePassphrase.value;
		const confirmation = retireConfirmation.value;
		retirePassphrase.value = '';
		retireConfirmation.value = '';
		setBusy(true);
		api.submit('retireVault', { passphrase, confirmation });
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
		replaceRecoveryPassphrase.value = '';
		retirePassphrase.value = '';
		retireConfirmation.value = '';
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
			feedback.operation === 'changePassphrase' ||
			feedback.operation === 'replaceRecoverySecret' ||
			feedback.operation === 'retireVault';
		recoverForm.hidden = feedback.operation !== 'recover';
		changePassphraseForm.hidden = feedback.operation !== 'changePassphrase';
		replaceRecoverySecretForm.hidden = feedback.operation !== 'replaceRecoverySecret';
		retireVaultForm.hidden = feedback.operation !== 'retireVault';
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
		if (feedback.operation === 'replaceRecoverySecret') {
			replaceRecoveryError.textContent =
				'That current passphrase did not unlock this vault.';
			replaceRecoveryError.hidden = false;
			error.hidden = true;
		}
		if (feedback.operation === 'retireVault') {
			retireError.textContent =
				'That passphrase or confirmation did not authorize vault deletion.';
			retireError.hidden = false;
			error.hidden = true;
		}
		focus(feedback.operation === 'recover' ? recoverSecret :
			feedback.operation === 'changePassphrase' ? currentPassphrase :
				feedback.operation === 'replaceRecoverySecret' ?
					replaceRecoveryPassphrase : feedback.operation === 'retireVault' ?
						retirePassphrase : input);
	});

	api.onRecoverySecret((secret, purpose) => {
		form.hidden = true;
		recoverForm.hidden = true;
		changePassphraseForm.hidden = true;
		replaceRecoverySecretForm.hidden = true;
		retireVaultForm.hidden = true;
		recovery.hidden = false;
		recoveryHeading.textContent = purpose === 'replace' ?
			'Save your replacement Recovery Secret' : 'Save your Recovery Secret';
		recoveryConfirm.textContent = purpose === 'replace' ?
			'Replace Recovery Secret' : 'Create encrypted vault';
		recoverySecret.textContent = secret;
		focus(recoveryConfirmation);
	});
})();
