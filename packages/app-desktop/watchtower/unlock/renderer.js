'use strict';

(() => {
	const api = window.watchtowerUnlock;
	const form = document.querySelector('#unlock-form');
	const input = document.querySelector('#passphrase');
	const error = document.querySelector('#error');
	const unlock = document.querySelector('#unlock');
	const create = document.querySelector('#create');
	const cancel = document.querySelector('#cancel');
	const progress = document.querySelector('#progress');
	const recovery = document.querySelector('#recovery');
	const recoverySecret = document.querySelector('#recovery-secret');
	const recoveryConfirmation = document.querySelector('#recovery-confirmation');
	const recoveryConfirm = document.querySelector('#recovery-confirm');
	const recoveryCancel = document.querySelector('#recovery-cancel');

	const setBusy = busy => {
		input.disabled = busy;
		unlock.disabled = busy;
		create.disabled = busy;
		progress.hidden = !busy;
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

	cancel.addEventListener('click', () => {
		input.value = '';
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
		form.hidden = false;
		recovery.hidden = true;
		recoverySecret.textContent = '';
		error.textContent = feedback.kind === 'passphraseRejected' ?
			'Choose a stronger, less commonly used passphrase.' :
			feedback.kind === 'alreadyExists' ?
				'A vault already exists. Unlock it instead.' :
				'That passphrase did not unlock this vault.';
		error.hidden = false;
		// This pre-profile asset cannot import Joplin's profile-bearing focus helper.
		// eslint-disable-next-line no-restricted-properties
		input.focus();
	});

	api.onRecoverySecret(secret => {
		form.hidden = true;
		recovery.hidden = false;
		recoverySecret.textContent = secret;
		// This pre-profile asset cannot import Joplin's profile-bearing focus helper.
		// eslint-disable-next-line no-restricted-properties
		recoveryConfirmation.focus();
	});
})();
