import {
	makeFailClosedDesktopDependencies,
	startWatchtowerDesktop,
} from './startWatchtowerDesktop';
import { ProfileHost, VaultAccessAdapter } from '../vault/PreProfileVaultBootstrap';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('startWatchtowerDesktop', () => {
	test('does not load profile-bearing code when vault access is rejected', async () => {
		const loadJoplinProfile = jest.fn();
		const accessAdapter: VaultAccessAdapter = {
			create: jest.fn(),
			unlock: async () => ({ kind: 'rejected', reason: 'wrongCredential' }),
			recover: jest.fn(),
			abort: jest.fn(() => true),
		};
		const profileHost: ProfileHost = {
			start: async () => {
				await loadJoplinProfile();
			},
			stop: jest.fn(),
			terminate: jest.fn(() => true),
		};

		const started = await startWatchtowerDesktop({
			operation: 'unlock',
			accessAdapter,
			profileHost,
		});

		expect(started.result).toEqual({ kind: 'rejected', reason: 'wrongCredential' });
		expect(started.lifecycle.state()).toBe('locked');
		expect(loadJoplinProfile).not.toHaveBeenCalled();
	});

	test('the production placeholder fails closed without loading Joplin', async () => {
		const dependencies = makeFailClosedDesktopDependencies();
		const startProfile = jest.spyOn(dependencies.profileHost, 'start');

		const started = await startWatchtowerDesktop(dependencies);

		expect(started.result).toEqual({ kind: 'failedClosed', stage: 'vaultAccess' });
		expect(started.lifecycle.state()).toBe('failedClosed');
		expect(startProfile).not.toHaveBeenCalled();
	});

	test('the production entrypoint contains no profile-bearing startup', () => {
		const mainSource = readFileSync(resolve(__dirname, '../../main.ts'), 'utf8');

		expect(mainSource).toContain('./watchtower/desktop/startWatchtowerDesktop');
		for (const forbiddenProfileStartup of [
			'ElectronAppWrapper',
			'determineBaseAppDirs',
			'mkdirpSync',
			'readFileSync',
			'settings.json',
		]) {
			expect(mainSource).not.toContain(forbiddenProfileStartup);
		}
	});
});
