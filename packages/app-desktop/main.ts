import {
	makeFailClosedDesktopDependencies,
	startWatchtowerDesktop,
} from './watchtower/desktop/startWatchtowerDesktop';

// Until the encrypted profile adapter supplies production dependencies,
// Watchtower exits failed closed. Stock Joplin startup must never be used as a
// plaintext fallback.
void startWatchtowerDesktop(makeFailClosedDesktopDependencies()).then(
	started => {
		if (started.result.kind !== 'unlocked') process.exitCode = 1;
	},
	() => {
		process.exitCode = 1;
	},
);
