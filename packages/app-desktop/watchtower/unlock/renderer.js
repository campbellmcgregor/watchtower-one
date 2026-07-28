'use strict';

(() => {
	const api = window.watchtowerUnlock;
	const form = document.querySelector('#unlock-form');
	const input = document.querySelector('#passphrase');
	const error = document.querySelector('#error');
	const unlock = document.querySelector('#unlock');
	const cancel = document.querySelector('#cancel');
	const progress = document.querySelector('#progress');

	const setBusy = busy => {
		input.disabled = busy;
		unlock.disabled = busy;
		progress.hidden = !busy;
	};

	form.addEventListener('submit', event => {
		event.preventDefault();
		const passphrase = input.value;
		input.value = '';
		error.hidden = true;
		setBusy(true);
		api.submit(passphrase);
	});

	cancel.addEventListener('click', () => {
		input.value = '';
		api.cancel();
	});

	api.onFeedback(feedback => {
		if (feedback.kind !== 'wrongCredential') return;
		setBusy(false);
		error.textContent = 'That passphrase did not unlock this vault.';
		error.hidden = false;
		// This pre-profile asset cannot import Joplin's profile-bearing focus helper.
		// eslint-disable-next-line no-restricted-properties
		input.focus();
	});
})();
