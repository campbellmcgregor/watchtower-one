import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
const replacementPassphrase = 'replacement private atlas notebook words';
const rotatedPassphrase = 'rotated private atlas notebook words';
const noteTitle = 'Watchtower usable application proof';
const noteCanary = 'WT1-USABLE-NOTE-CANARY-20260801';
const forcedTerminationNoteTitle = 'Watchtower forced termination proof';
const forcedTerminationCanary = 'WT1-FORCED-TERMINATION-CANARY-20260803';

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

const scanForPlaintext = async (
	scenario: string,
	fileName: string,
	canaries: Record<string, string>,
) => {
	const evidencePath = join(runRoot, fileName);
	const canaryArguments = Object.entries(canaries).flatMap(([id, value]) => [
		'--canary',
		`${id}=${value}`,
	]);
	await executeFile(process.execPath, [
		scanner,
		'snapshot',
		'--scenario',
		scenario,
		'--root',
		`smoke=${runRoot}`,
		...canaryArguments,
		'--output',
		evidencePath,
	], { cwd: repository });
	const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
	expect(evidence.errors).toEqual([]);
	expect(evidence.files.filter((file: { canaries: { id: string }[] }) => (
		file.canaries.length
	))).toEqual([]);
};

const forceTerminate = async (application: Awaited<ReturnType<typeof launch>>) => {
	const childProcess = application.process();
	const applicationClosed = application.waitForEvent('close');
	if (process.platform === 'win32') {
		await executeFile('taskkill', [
			'/PID',
			String(childProcess.pid),
			'/T',
			'/F',
		]);
	} else {
		childProcess.kill('SIGKILL');
	}
	await applicationClosed;
};

test('survives restart, forced termination, recovery, and credential rotation without plaintext fallback', async () => {
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

	await scanForPlaintext(
		'watchtower-first-run-closed',
		'plaintext-scan.json',
		{ note: noteCanary },
	);

	const reopenedApplication = await launch();
	const reopenUnlock = await reopenedApplication.firstWindow();
	await reopenUnlock.locator('#passphrase').fill(passphrase);
	await reopenUnlock.locator('#unlock').click();
	const reopenedWindow = await waitForJoplinWindow(reopenedApplication);
	await expect(reopenedWindow.getByText(noteTitle)).toBeVisible({ timeout: 30_000 });

	const reopenedScreen = new MainScreen(reopenedWindow);
	await reopenedScreen.waitFor();
	const forcedTerminationEditor = await reopenedScreen.createNewNote(forcedTerminationNoteTitle);
	await forcedTerminationEditor.focusCodeMirrorEditor();
	await reopenedWindow.keyboard.type(forcedTerminationCanary);
	await expect(reopenedWindow.getByText(forcedTerminationNoteTitle)).toBeVisible();
	await new Promise(resolveDelay => setTimeout(resolveDelay, 5_000));

	await forceTerminate(reopenedApplication);
	await new Promise(resolveDelay => setTimeout(resolveDelay, 500));
	await scanForPlaintext(
		'watchtower-forced-termination-closed',
		'forced-termination-plaintext-scan.json',
		{
			note: noteCanary,
			forcedTerminationNote: forcedTerminationCanary,
		},
	);

	const recoveredApplication = await launch();
	const recoveredUnlock = await recoveredApplication.firstWindow();
	await recoveredUnlock.locator('#passphrase').fill(passphrase);
	await recoveredUnlock.locator('#unlock').click();
	const recoveredWindow = await waitForJoplinWindow(recoveredApplication);
	const recoveredScreen = new MainScreen(recoveredWindow);
	await recoveredScreen.waitFor();
	await recoveredWindow.getByText(forcedTerminationNoteTitle).first().click();
	await expect(recoveredScreen.noteEditor.noteTitleInput).toHaveValue(forcedTerminationNoteTitle);
	await recoveredScreen.noteEditor.expectToHaveText(forcedTerminationCanary);
	await recoveredApplication.close();
	await new Promise(resolveDelay => setTimeout(resolveDelay, 2_000));

	const recoveryApplication = await launch();
	const recoveryUnlock = await recoveryApplication.firstWindow();
	await recoveryUnlock.locator('#recover').click();
	await expect(recoveryUnlock.locator('#recover-form')).toBeVisible();
	await recoveryUnlock.locator('#recover-secret').fill(recoverySecret!);
	await recoveryUnlock.locator('#recover-passphrase').fill(replacementPassphrase);
	await recoveryUnlock.locator('#recover-submit').click();
	const recoveryWindow = await waitForJoplinWindow(recoveryApplication);
	await expect(recoveryWindow.getByText(forcedTerminationNoteTitle)).toBeVisible({ timeout: 30_000 });
	await recoveryApplication.close();
	await new Promise(resolveDelay => setTimeout(resolveDelay, 2_000));

	await scanForPlaintext(
		'watchtower-recovery-credential-rewrap-closed',
		'recovery-plaintext-scan.json',
		{
			note: noteCanary,
			forcedTerminationNote: forcedTerminationCanary,
			recoverySecret: recoverySecret!,
			replacementPassphrase,
		},
	);

	const retiredPassphraseApplication = await launch();
	const retiredPassphraseUnlock = await retiredPassphraseApplication.firstWindow();
	await retiredPassphraseUnlock.locator('#passphrase').fill(passphrase);
	await retiredPassphraseUnlock.locator('#unlock').click();
	await expect(retiredPassphraseUnlock.locator('#error')).toHaveText(
		'That passphrase did not unlock this vault.',
		{ timeout: 30_000 },
	);
	const retiredPassphraseClosed = retiredPassphraseApplication.waitForEvent('close');
	await retiredPassphraseUnlock.locator('#cancel').click();
	await retiredPassphraseClosed;

	const rotationApplication = await launch();
	const rotationUnlock = await rotationApplication.firstWindow();
	await rotationUnlock.locator('#change-passphrase').click();
	await expect(rotationUnlock.locator('#change-passphrase-form')).toBeVisible();
	await rotationUnlock.locator('#current-passphrase').fill(replacementPassphrase);
	await rotationUnlock.locator('#new-passphrase').fill(rotatedPassphrase);
	await rotationUnlock.locator('#change-passphrase-submit').click();
	const rotationWindow = await waitForJoplinWindow(rotationApplication);
	await expect(rotationWindow.getByText(forcedTerminationNoteTitle)).toBeVisible({ timeout: 30_000 });
	await rotationApplication.close();
	await new Promise(resolveDelay => setTimeout(resolveDelay, 2_000));

	await scanForPlaintext(
		'watchtower-passphrase-rotation-closed',
		'passphrase-rotation-plaintext-scan.json',
		{
			note: noteCanary,
			forcedTerminationNote: forcedTerminationCanary,
			recoverySecret: recoverySecret!,
			replacementPassphrase,
			rotatedPassphrase,
		},
	);

	const preRotationPassphraseApplication = await launch();
	const preRotationPassphraseUnlock = await preRotationPassphraseApplication.firstWindow();
	await preRotationPassphraseUnlock.locator('#passphrase').fill(replacementPassphrase);
	await preRotationPassphraseUnlock.locator('#unlock').click();
	await expect(preRotationPassphraseUnlock.locator('#error')).toHaveText(
		'That passphrase did not unlock this vault.',
		{ timeout: 30_000 },
	);
	const preRotationPassphraseClosed = preRotationPassphraseApplication.waitForEvent('close');
	await preRotationPassphraseUnlock.locator('#cancel').click();
	await preRotationPassphraseClosed;

	const replacementApplication = await launch();
	const replacementUnlock = await replacementApplication.firstWindow();
	await replacementUnlock.locator('#replace-recovery-secret').click();
	await expect(replacementUnlock.locator('#replace-recovery-secret-form')).toBeVisible();
	await replacementUnlock.locator('#replace-recovery-passphrase').fill(rotatedPassphrase);
	await replacementUnlock.locator('#replace-recovery-submit').click();
	await replacementUnlock.locator('#recovery').waitFor({ state: 'visible', timeout: 120_000 });
	const replacementRecoverySecret = await replacementUnlock.locator('#recovery-secret').textContent();
	expect(replacementRecoverySecret).toMatch(/^WT1-/);
	expect(replacementRecoverySecret).not.toBe(recoverySecret);
	await replacementUnlock.locator('#recovery-confirmation').fill(replacementRecoverySecret!);
	await replacementUnlock.locator('#recovery-confirm').click();
	const replacementWindow = await waitForJoplinWindow(replacementApplication);
	await expect(replacementWindow.getByText(forcedTerminationNoteTitle)).toBeVisible({ timeout: 30_000 });
	await replacementApplication.close();
	await new Promise(resolveDelay => setTimeout(resolveDelay, 2_000));

	await scanForPlaintext(
		'watchtower-recovery-secret-replacement-closed',
		'recovery-secret-replacement-plaintext-scan.json',
		{
			note: noteCanary,
			forcedTerminationNote: forcedTerminationCanary,
			recoverySecret: recoverySecret!,
			replacementRecoverySecret: replacementRecoverySecret!,
			replacementPassphrase,
			rotatedPassphrase,
		},
	);

	const retiredRecoveryApplication = await launch();
	const retiredRecoveryUnlock = await retiredRecoveryApplication.firstWindow();
	await retiredRecoveryUnlock.locator('#recover').click();
	await retiredRecoveryUnlock.locator('#recover-secret').fill(recoverySecret!);
	await retiredRecoveryUnlock.locator('#recover-passphrase').fill(replacementPassphrase);
	await retiredRecoveryUnlock.locator('#recover-submit').click();
	await expect(retiredRecoveryUnlock.locator('#recover-error')).toHaveText(
		'That Recovery Secret did not unlock this vault.',
		{ timeout: 30_000 },
	);
	await retiredRecoveryUnlock.locator('#recover-back').click();
	const retiredRecoveryClosed = retiredRecoveryApplication.waitForEvent('close');
	await retiredRecoveryUnlock.locator('#cancel').click();
	await retiredRecoveryClosed;

	const envelopePath = join(
		runRoot,
		'Watchtower One',
		'vault',
		'envelope',
		'vault-key-envelope.json',
	);
	const committedEnvelope = await readFile(envelopePath);
	await writeFile(envelopePath, '{"incomplete":', 'utf8');
	const corruptApplication = await launch();
	const corruptProcess = corruptApplication.process();
	const corruptProcessExited = new Promise<number | null>(resolveExitCode => {
		if (corruptProcess.exitCode !== null) {
			resolveExitCode(corruptProcess.exitCode);
		} else {
			corruptProcess.once('exit', resolveExitCode);
		}
	});
	const corruptUnlock = await corruptApplication.firstWindow();
	const corruptApplicationClosed = corruptApplication.waitForEvent('close');
	await corruptUnlock.locator('#passphrase').fill(rotatedPassphrase);
	await corruptUnlock.locator('#unlock').click();
	await corruptApplicationClosed;
	expect(corruptApplication.windows().filter(window => !window.isClosed())).toEqual([]);
	expect(await corruptProcessExited).toBe(1);

	await scanForPlaintext(
		'watchtower-corrupt-envelope-failed-closed',
		'corrupt-envelope-plaintext-scan.json',
		{
			note: noteCanary,
			forcedTerminationNote: forcedTerminationCanary,
			recoverySecret: recoverySecret!,
			replacementRecoverySecret: replacementRecoverySecret!,
			replacementPassphrase,
			rotatedPassphrase,
		},
	);
	const databaseHeader = await readFile(join(
		runRoot,
		'Watchtower One',
		'vault',
		'profile.sqlite',
	));
	expect(databaseHeader.subarray(0, 16).toString('utf8')).not.toBe('SQLite format 3\0');

	await writeFile(envelopePath, committedEnvelope);
	const retirementApplication = await launch();
	const retirementProcess = retirementApplication.process();
	const retirementProcessExited = new Promise<number | null>(resolveExitCode => {
		if (retirementProcess.exitCode !== null) resolveExitCode(retirementProcess.exitCode);
		else retirementProcess.once('exit', resolveExitCode);
	});
	const retirementUnlock = await retirementApplication.firstWindow();
	await retirementUnlock.locator('#retire-vault').click();
	await expect(retirementUnlock.locator('#retire-vault-form')).toBeVisible();
	await retirementUnlock.locator('#retire-passphrase').fill(rotatedPassphrase);
	await retirementUnlock.locator('#retire-confirmation').fill('DELETE MY VAULT');
	const retirementApplicationClosed = retirementApplication.waitForEvent('close');
	await retirementUnlock.locator('#retire-submit').click();
	await retirementApplicationClosed;
	expect(await retirementProcessExited).toBe(0);

	await scanForPlaintext(
		'watchtower-vault-retired-and-removed',
		'vault-retirement-plaintext-scan.json',
		{
			note: noteCanary,
			forcedTerminationNote: forcedTerminationCanary,
			recoverySecret: recoverySecret!,
			replacementRecoverySecret: replacementRecoverySecret!,
			replacementPassphrase,
			rotatedPassphrase,
		},
	);

	await mkdir(join(runRoot, 'Watchtower One', 'vault', 'envelope'), { recursive: true });
	await writeFile(envelopePath, committedEnvelope);
	const restoredApplication = await launch();
	const restoredProcess = restoredApplication.process();
	const restoredProcessExited = new Promise<number | null>(resolveExitCode => {
		if (restoredProcess.exitCode !== null) resolveExitCode(restoredProcess.exitCode);
		else restoredProcess.once('exit', resolveExitCode);
	});
	const restoredUnlock = await restoredApplication.firstWindow();
	const restoredApplicationClosed = restoredApplication.waitForEvent('close');
	await restoredUnlock.locator('#passphrase').fill(rotatedPassphrase);
	await restoredUnlock.locator('#unlock').click();
	await restoredApplicationClosed;
	expect(await restoredProcessExited).toBe(1);
	await expect(readFile(envelopePath)).rejects.toMatchObject({ code: 'ENOENT' });

	await scanForPlaintext(
		'watchtower-retired-envelope-restoration-failed-closed',
		'retired-envelope-restoration-plaintext-scan.json',
		{
			note: noteCanary,
			forcedTerminationNote: forcedTerminationCanary,
			recoverySecret: recoverySecret!,
			replacementRecoverySecret: replacementRecoverySecret!,
			replacementPassphrase,
			rotatedPassphrase,
		},
	);
});
