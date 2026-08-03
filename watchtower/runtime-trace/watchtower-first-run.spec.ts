import { execFile } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { _electron as electron, expect, test } from '../../packages/app-desktop/node_modules/@playwright/test';
import MainScreen from '../../packages/app-desktop/integration-tests/models/MainScreen';

// cspell:ignore appdata

const executeFile = promisify(execFile);
const repository = resolve(__dirname, '../..');
const executable = join(
	repository,
	'packages',
	'app-desktop',
	'dist',
	'win-unpacked',
	'Joplin.exe',
);
const scanner = join(repository, 'watchtower', 'tools', 'plaintext-trace.mjs');
const runRoot = join(repository, 'packages', 'app-desktop', 'test-results', 'watchtower-first-run');
const passphrase = 'first private atlas notebook words';
const noteTitle = 'Watchtower usable application proof';
const noteCanary = 'WT1-USABLE-NOTE-CANARY-20260801';

const launch = async () => {
	const roaming = join(runRoot, 'appdata', 'roaming');
	const local = join(runRoot, 'appdata', 'local');
	const temporary = join(runRoot, 'temp');
	for (const path of [roaming, local, temporary]) {
		await mkdir(path, { recursive: true });
	}
	const application = await electron.launch({
		executablePath: executable,
		args: [
			'--running-tests',
			'--watchtower-data-root',
			runRoot,
		],
		env: {
			...process.env,
			APPDATA: roaming,
			LOCALAPPDATA: local,
			TEMP: temporary,
			TMP: temporary,
		},
	});
	return application;
};

const waitForJoplinWindow = async (application: Awaited<ReturnType<typeof launch>>) => {
	for (let attempt = 0; attempt < 120; attempt++) {
		const windows = application.windows();
		for (const window of windows) {
			if (window.isClosed()) continue;
			try {
				if (await window.locator('.note-list').count()) return window;
			} catch (error) {
				if (!window.isClosed()) throw error;
			}
		}
		await new Promise(resolveDelay => setTimeout(resolveDelay, 500));
	}
	throw new Error('Joplin note window did not appear after vault unlock');
};

test('creates, uses, closes, and reopens an encrypted Watchtower vault', async () => {
	await rm(runRoot, { recursive: true, force: true });
	const application = await launch();
	const unlock = await application.firstWindow();
	await expect(unlock.getByRole('heading', { name: 'Unlock your vault' })).toBeVisible();
	await unlock.locator('#passphrase').fill(passphrase);
	await unlock.locator('#create').click();
	await unlock.locator('#recovery').waitFor({ state: 'visible', timeout: 120_000 });
	const recoverySecret = await unlock.locator('#recovery-secret').textContent();
	expect(recoverySecret).toMatch(/^WT1-/);
	await unlock.locator('#recovery-confirmation').fill(recoverySecret!);
	await unlock.locator('#recovery-confirm').click();

	const mainWindow = await waitForJoplinWindow(application);
	await mainWindow.setViewportSize({ width: 1300, height: 800 });
	const screen = await new MainScreen(mainWindow).setup();
	const editor = await screen.createNewNote(noteTitle);
	await editor.focusCodeMirrorEditor();
	await mainWindow.keyboard.type(noteCanary);
	await expect(mainWindow.getByText(noteTitle)).toBeVisible();
	await mainWindow.screenshot({ path: join(runRoot, 'usable-note-window.png') });
	await application.close();
	await new Promise(resolveDelay => setTimeout(resolveDelay, 2_000));

	const evidencePath = join(runRoot, 'plaintext-scan.json');
	await executeFile(process.execPath, [
		scanner,
		'snapshot',
		'--scenario',
		'watchtower-first-run-closed',
		'--root',
		`smoke=${runRoot}`,
		'--canary',
		`note=${noteCanary}`,
		'--output',
		evidencePath,
	], { cwd: repository });
	const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
	expect(evidence.files.filter((file: { canaries: { id: string }[] }) => (
		file.canaries.some(canary => canary.id === 'note')
	))).toEqual([]);

	const reopenedApplication = await launch();
	const reopenUnlock = await reopenedApplication.firstWindow();
	await reopenUnlock.locator('#passphrase').fill(passphrase);
	await reopenUnlock.locator('#unlock').click();
	const reopenedWindow = await waitForJoplinWindow(reopenedApplication);
	await expect(reopenedWindow.getByText(noteTitle)).toBeVisible({ timeout: 30_000 });
	await reopenedApplication.close();
});
