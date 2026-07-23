// cspell:ignore APPDATA appdata taskkill

import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { _electron as electron, expect, test } from '../../packages/app-desktop/node_modules/@playwright/test';
import MainScreen from '../../packages/app-desktop/integration-tests/models/MainScreen';
import activateMainMenuItem from '../../packages/app-desktop/integration-tests/util/activateMainMenuItem';
import setFilePickerResponse from '../../packages/app-desktop/integration-tests/util/setFilePickerResponse';
import waitForNextOpenPath from '../../packages/app-desktop/integration-tests/util/waitForNextOpenPath';

const executeFile = promisify(execFile);
const repository = resolve(__dirname, '../..');
const desktopDirectory = join(repository, 'packages', 'app-desktop');
const mainBundle = join(desktopDirectory, 'main.bundle.js');
const scanner = join(repository, 'watchtower', 'tools', 'plaintext-trace.mjs');
const pluginPath = join(__dirname, 'fixtures', 'plaintext-canary-plugin.js');
const resourcePath = join(__dirname, 'fixtures', 'resource-canary.txt');

const noteCanary = 'WT1-ISSUE7-NOTE-CANARY-20260723';
const resourceCanary = 'WT1-ISSUE7-RESOURCE-CANARY-20260723';
const pluginCanary = 'WT1-ISSUE7-PLUGIN-CANARY-20260723';
const noteTitle = 'Watchtower issue 7 runtime trace';

const requiredEnvironmentPath = (name: string) => {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required`);
	return resolve(value);
};

const delay = (milliseconds: number) => new Promise(resolveDelay => {
	setTimeout(resolveDelay, milliseconds);
});

test('records the pinned baseline plaintext footprint across runtime scenarios', async () => {
	const runRoot = requiredEnvironmentPath('WATCHTOWER_TRACE_ROOT');
	const evidenceDirectory = requiredEnvironmentPath('WATCHTOWER_TRACE_EVIDENCE');
	await mkdir(runRoot, { recursive: true });
	const existingRunEntries = await readdir(runRoot);
	expect(existingRunEntries, 'WATCHTOWER_TRACE_ROOT must be empty').toEqual([]);
	await mkdir(evidenceDirectory, { recursive: true });

	const homeDirectory = join(runRoot, 'home');
	const roamingAppData = join(runRoot, 'appdata', 'roaming');
	const localAppData = join(runRoot, 'appdata', 'local');
	const temporaryDirectory = join(runRoot, 'temp');
	const electronUserData = join(runRoot, 'electron-user-data');
	for (const directory of [
		homeDirectory,
		roamingAppData,
		localAppData,
		temporaryDirectory,
		electronUserData,
	]) {
		await mkdir(directory, { recursive: true });
	}
	const profileDirectory = join(homeDirectory, '.config', 'joplindev-desktop');
	const childEnvironment = {
		...process.env,
		APPDATA: roamingAppData,
		LOCALAPPDATA: localAppData,
		TEMP: temporaryDirectory,
		TMP: temporaryDirectory,
	};
	const startupArguments = [
		mainBundle,
		'--env',
		'dev',
		'--lang=en-GB',
		'--log-level',
		'debug',
		'--no-welcome',
		'--running-tests',
		'--profile',
		profileDirectory,
		`--user-data-dir=${electronUserData}`,
	];
	const launchApplication = async (plugins: string[] = []) => {
		const arguments_ = [...startupArguments];
		if (plugins.length) arguments_.push('--dev-plugins', plugins.join(','));
		const app = await electron.launch({
			args: arguments_,
			cwd: desktopDirectory,
			env: childEnvironment,
		});
		const window = await app.firstWindow();
		await window.setViewportSize({ width: 1300, height: 800 });
		const screen = new MainScreen(window);
		await screen.waitFor();
		return { app, window, screen };
	};

	const snapshots = [];
	const snapshot = async (number: number, scenario: string) => {
		const output = join(
			evidenceDirectory,
			`${String(number).padStart(2, '0')}-${scenario}.json`,
		);
		await executeFile(process.execPath, [
			scanner,
			'snapshot',
			'--scenario',
			scenario,
			'--root',
			`sandbox=${runRoot}`,
			'--canary',
			`note=${noteCanary}`,
			'--canary',
			`resource=${resourceCanary}`,
			'--canary',
			`plugin=${pluginCanary}`,
			'--output',
			output,
		], { cwd: repository });
		const manifest = JSON.parse(await readFile(output, 'utf8'));
		manifest.roots = manifest.roots.map((root: { id: string; path: string }) => ({
			...root,
			path: root.id === 'sandbox' ? '<trace-root>' : '<redacted-root>',
		}));
		await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
		snapshots.push({ scenario, output, manifest });
		return manifest;
	};
	const canaryFiles = (manifest: {
		files: { root: string; path: string; canaries: { id: string }[] }[];
	}, id: string) => manifest.files.filter(file => (
		file.canaries.some(canary => canary.id === id)
	));

	const clean = await launchApplication();
	const electronPaths = await clean.app.evaluate(({ app }) => {
		const names = [
			'home',
			'appData',
			'userData',
			'sessionData',
			'temp',
			'logs',
			'crashDumps',
		] as const;
		return Object.fromEntries(names.map(name => [name, app.getPath(name)]));
	});
	for (const [name, path] of Object.entries(electronPaths).filter(
		([name]) => !['appData', 'home'].includes(name),
	)) {
		const pathRelativeToRun = relative(runRoot, path);
		expect(
			!pathRelativeToRun.startsWith('..') && !isAbsolute(pathRelativeToRun),
			`Electron ${name} path escaped the controlled trace root: ${path}`,
		).toBe(true);
	}
	await writeFile(join(evidenceDirectory, 'environment.json'), `${JSON.stringify({
		schemaVersion: 1,
		baseline: {
			tag: 'v3.6.15',
			commit: 'c61572660382863595c6b51ccf2263e3d2c4bfce',
		},
		platform: process.platform,
		architecture: process.arch,
		node: process.version,
		observationRoot: '<trace-root>',
		profileDirectory: '<trace-root>/home/.config/joplindev-desktop',
		electronPaths: Object.fromEntries(Object.entries(electronPaths).map(([name, path]) => {
			const pathRelativeToRun = relative(runRoot, path);
			if (!pathRelativeToRun.startsWith('..') && !isAbsolute(pathRelativeToRun)) {
				return [name, `<trace-root>/${pathRelativeToRun.split(sep).join('/')}`];
			}
			return [name, name === 'home' ? '<host-home>' : '<host-app-data>'];
		})),
		hostPathsNotScanned: ['home', 'appData'],
	}, null, 2)}\n`, 'utf8');

	const cleanLive = await snapshot(1, 'clean-startup-live');
	expect(canaryFiles(cleanLive, 'note')).toEqual([]);
	expect(canaryFiles(cleanLive, 'resource')).toEqual([]);
	expect(canaryFiles(cleanLive, 'plugin')).toEqual([]);
	await clean.app.close();
	await delay(500);
	const cleanClosed = await snapshot(2, 'clean-startup-closed');
	expect(cleanClosed.errors).toEqual([]);

	const active = await launchApplication([pluginPath]);
	await active.screen.setup();
	await active.screen.goToAnything.runCommand(active.app, 'watchtowerTracePluginReady');
	const editor = await active.screen.createNewNote(noteTitle);
	await editor.focusCodeMirrorEditor();
	await active.window.keyboard.type(noteCanary);
	await setFilePickerResponse(active.app, [resourcePath]);
	await editor.attachFileButton.click();
	await expect(editor.getNoteViewerFrameLocator().getByText('resource-canary.txt')).toBeVisible();
	await delay(1_000);

	const noteResourcePlugin = await snapshot(3, 'note-resource-plugin-live');
	expect(canaryFiles(noteResourcePlugin, 'note').length).toBeGreaterThan(0);
	expect(canaryFiles(noteResourcePlugin, 'resource').length).toBeGreaterThan(0);
	expect(canaryFiles(noteResourcePlugin, 'plugin').length).toBeGreaterThan(0);

	const externalPathPromise = waitForNextOpenPath(active.app);
	await active.screen.goToAnything.runCommand(active.app, 'startExternalEditing');
	const externalPath = await externalPathPromise;
	expect(await readFile(externalPath, 'utf8')).toContain(noteCanary);
	const externalEdit = await snapshot(4, 'external-edit-live');
	expect(canaryFiles(externalEdit, 'note').some(file => (
		file.path.includes('/edit-') || file.path.startsWith('home/.config/joplindev-desktop/edit-')
	))).toBe(true);

	await activateMainMenuItem(active.app, 'Create backup');
	const backupDialog = active.window.locator('iframe[id$=backup-backupDialog]');
	await backupDialog.waitFor();
	await backupDialog.contentFrame().getByText('Backup completed').waitFor();
	const backup = await snapshot(5, 'backup-live');
	expect(canaryFiles(backup, 'note').some(file => file.path.includes('JoplinBackup'))).toBe(true);

	await activateMainMenuItem(active.app, 'Check for updates...');
	await delay(3_000);
	await snapshot(6, 'update-check-live');

	const rendererCrash = (async () => {
		try {
			await active.app.evaluate(({ BrowserWindow }) => {
				const renderer = BrowserWindow.getAllWindows()[0].webContents;
				renderer.forcefullyCrashRenderer();
			});
		} catch {
			// The renderer can disappear before Playwright acknowledges the command.
		}
	})();
	await Promise.race([rendererCrash, delay(2_000)]);
	await snapshot(7, 'renderer-crash-live');

	const childProcess = active.app.process();
	const applicationClosed = active.app.waitForEvent('close');
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
	await delay(500);
	const forcedTermination = await snapshot(8, 'forced-termination-closed');
	expect(forcedTermination.errors).toEqual([]);
	expect(canaryFiles(forcedTermination, 'note').length).toBeGreaterThan(0);

	await delay(5_000);
	const recovery = await launchApplication();
	await recovery.screen.search(noteTitle);
	await recovery.window.getByText(noteTitle).first().waitFor();
	await snapshot(9, 'recovery-restart-live');
	await recovery.app.close();
	await delay(500);
	const recoveryClosed = await snapshot(10, 'recovery-restart-closed');
	expect(recoveryClosed.errors).toEqual([]);

	await writeFile(join(evidenceDirectory, 'trace-summary.json'), `${JSON.stringify({
		schemaVersion: 1,
		scenarios: snapshots.map(item => ({
			scenario: item.scenario,
			manifest: relative(evidenceDirectory, item.output).split(sep).join('/'),
			fileCount: item.manifest.files.length,
			errorCount: item.manifest.errors.length,
			canaryFileCounts: Object.fromEntries(['note', 'resource', 'plugin'].map(id => [
				id,
				canaryFiles(item.manifest, id).length,
			])),
		})),
		externalEditPath: relative(runRoot, externalPath).split(sep).join('/'),
	}, null, 2)}\n`, 'utf8');
});
