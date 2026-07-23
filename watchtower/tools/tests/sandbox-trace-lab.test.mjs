import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const launcherPath = fileURLToPath(
	new URL('../../sandbox-trace/Launch-WatchtowerTraceLab.ps1', import.meta.url),
);

test('host launcher prepares an isolated Sandbox with immutable inputs and writable evidence', {
	skip: process.platform !== 'win32',
}, async () => {
	const temporaryDirectory = await mkdtemp(join(tmpdir(), 'watchtower-sandbox-trace-'));
	const applicationDirectory = join(temporaryDirectory, 'Application & Package');
	const toolsDirectory = join(temporaryDirectory, 'Sysinternals');
	const evidenceDirectory = join(temporaryDirectory, 'Evidence');
	const labDirectory = join(temporaryDirectory, 'Lab');
	const applicationPath = join(applicationDirectory, 'Watchtower One.exe');
	const procmonPath = join(toolsDirectory, 'Procmon64.exe');
	await mkdir(applicationDirectory);
	await mkdir(toolsDirectory);
	await mkdir(evidenceDirectory);
	await writeFile(applicationPath, 'packaged-application');
	await writeFile(procmonPath, 'procmon');

	const result = spawnSync('powershell.exe', [
		'-NoProfile',
		'-ExecutionPolicy',
		'Bypass',
		'-File',
		launcherPath,
		'-ApplicationPath',
		applicationPath,
		'-ProcmonPath',
		procmonPath,
		'-EvidencePath',
		evidenceDirectory,
		'-LabPath',
		labDirectory,
		'-Mode',
		'Smoke',
		'-PrepareOnly',
	], { encoding: 'utf8' });

	assert.equal(result.status, 0, result.stderr);
	const launch = JSON.parse(result.stdout);
	assert.equal(launch.schemaVersion, 2);
	assert.equal(launch.mode, 'Smoke');
	assert.equal(launch.launched, false);
	assert.equal(launch.application.sha256, 'bbdd26890973472bbeec0ec33240dbafc18b5bf058c51de9d6b0471a56feb528');
	assert.equal(launch.procmon.sha256, 'd86580392e249926e944c40917377c0428bb1afc300fe31d4d321900da973495');

	const configuration = await readFile(launch.configurationPath, 'utf8');
	assert.match(configuration, /<Networking>Disable<\/Networking>/);
	assert.match(configuration, /<ClipboardRedirection>Disable<\/ClipboardRedirection>/);
	assert.match(configuration, /<ProtectedClient>Enable<\/ProtectedClient>/);
	assert.match(configuration, /<MemoryInMB>3072<\/MemoryInMB>/);
	assert.match(configuration, /Application &amp; Package/);
	assert.match(configuration, /<SandboxFolder>C:\\WatchtowerInput\\Application<\/SandboxFolder>/);
	assert.match(configuration, /<ReadOnly>true<\/ReadOnly>/);
	assert.match(configuration, /<SandboxFolder>C:\\WatchtowerEvidence<\/SandboxFolder>/);
	assert.match(configuration, /<ReadOnly>false<\/ReadOnly>/);
	assert.match(configuration, /Invoke-WatchtowerSandboxTrace\.ps1/);
	assert.match(configuration, /&quot;C:\\WatchtowerInput\\Application\\Watchtower One\.exe&quot;/);
	assert.doesNotMatch(configuration, /&apos;/);
	await access(join(launch.harness.path, 'Invoke-WatchtowerSandboxTrace.ps1'));
	const persistedLaunch = JSON.parse(
		await readFile(join(evidenceDirectory, 'sandbox-launch.json'), 'utf8'),
	);
	assert.deepEqual(persistedLaunch, launch);
});

test('host launcher rejects evidence that overlaps a read-only input', {
	skip: process.platform !== 'win32',
}, async () => {
	const temporaryDirectory = await mkdtemp(join(tmpdir(), 'watchtower-sandbox-overlap-'));
	const applicationDirectory = join(temporaryDirectory, 'Application');
	const toolsDirectory = join(temporaryDirectory, 'Sysinternals');
	const evidenceDirectory = join(applicationDirectory, 'Evidence');
	const applicationPath = join(applicationDirectory, 'Watchtower One.exe');
	const procmonPath = join(toolsDirectory, 'Procmon64.exe');
	await mkdir(evidenceDirectory, { recursive: true });
	await mkdir(toolsDirectory);
	await writeFile(applicationPath, 'packaged-application');
	await writeFile(procmonPath, 'procmon');

	const result = spawnSync('powershell.exe', [
		'-NoProfile',
		'-ExecutionPolicy',
		'Bypass',
		'-File',
		launcherPath,
		'-ApplicationPath',
		applicationPath,
		'-ProcmonPath',
		procmonPath,
		'-EvidencePath',
		evidenceDirectory,
		'-LabPath',
		join(temporaryDirectory, 'Lab'),
		'-PrepareOnly',
	], { encoding: 'utf8' });

	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /EvidencePath must not overlap a read-only input/);
});

test('host launcher prepares a bounded packaged trace command', {
	skip: process.platform !== 'win32',
}, async () => {
	const temporaryDirectory = await mkdtemp(join(tmpdir(), 'watchtower-sandbox-mode-'));
	const applicationDirectory = join(temporaryDirectory, 'Application');
	const toolsDirectory = join(temporaryDirectory, 'Sysinternals');
	const evidenceDirectory = join(temporaryDirectory, 'Evidence');
	const applicationPath = join(applicationDirectory, 'Watchtower One.exe');
	const procmonPath = join(toolsDirectory, 'Procmon64.exe');
	await mkdir(applicationDirectory);
	await mkdir(toolsDirectory);
	await mkdir(evidenceDirectory);
	await writeFile(applicationPath, 'packaged-application');
	await writeFile(procmonPath, 'procmon');

	const result = spawnSync('powershell.exe', [
		'-NoProfile',
		'-ExecutionPolicy',
		'Bypass',
		'-File',
		launcherPath,
		'-ApplicationPath',
		applicationPath,
		'-ProcmonPath',
		procmonPath,
		'-EvidencePath',
		evidenceDirectory,
		'-LabPath',
		join(temporaryDirectory, 'Lab'),
		'-Mode',
		'Trace',
		'-TraceDurationSeconds',
		'20',
		'-ExpectedApplicationSha256',
		'bbdd26890973472bbeec0ec33240dbafc18b5bf058c51de9d6b0471a56feb528',
		'-ExpectedProcmonSha256',
		'd86580392e249926e944c40917377c0428bb1afc300fe31d4d321900da973495',
		'-PrepareOnly',
	], { encoding: 'utf8' });

	assert.equal(result.status, 0, result.stderr);
	const launch = JSON.parse(result.stdout);
	assert.equal(launch.schemaVersion, 2);
	assert.equal(launch.mode, 'Trace');
	assert.equal(launch.traceDurationSeconds, 20);
	assert.equal(launch.application.verifiedAgainstExpectedHash, true);
	assert.equal(launch.procmon.verifiedAgainstExpectedHash, true);
	const configuration = await readFile(launch.configurationPath, 'utf8');
	assert.match(configuration, /-Mode &quot;Trace&quot;/);
	assert.match(configuration, /-TraceDurationSeconds 20/);
});

test('host launcher prepares the packaged note-resource-plugin scenario', {
	skip: process.platform !== 'win32',
}, async () => {
	const temporaryDirectory = await mkdtemp(join(tmpdir(), 'watchtower-sandbox-content-'));
	const applicationDirectory = join(temporaryDirectory, 'Application');
	const toolsDirectory = join(temporaryDirectory, 'Sysinternals');
	const evidenceDirectory = join(temporaryDirectory, 'Evidence');
	const applicationPath = join(applicationDirectory, 'Watchtower One.exe');
	const procmonPath = join(toolsDirectory, 'Procmon64.exe');
	await mkdir(applicationDirectory);
	await mkdir(toolsDirectory);
	await mkdir(evidenceDirectory);
	await writeFile(applicationPath, 'packaged-application');
	await writeFile(procmonPath, 'procmon');

	const result = spawnSync('powershell.exe', [
		'-NoProfile',
		'-ExecutionPolicy',
		'Bypass',
		'-File',
		launcherPath,
		'-ApplicationPath',
		applicationPath,
		'-ProcmonPath',
		procmonPath,
		'-EvidencePath',
		evidenceDirectory,
		'-LabPath',
		join(temporaryDirectory, 'Lab'),
		'-Mode',
		'Trace',
		'-Scenario',
		'NoteResourcePlugin',
		'-ExpectedApplicationSha256',
		'bbdd26890973472bbeec0ec33240dbafc18b5bf058c51de9d6b0471a56feb528',
		'-ExpectedProcmonSha256',
		'd86580392e249926e944c40917377c0428bb1afc300fe31d4d321900da973495',
		'-PrepareOnly',
	], { encoding: 'utf8' });

	assert.equal(result.status, 0, result.stderr);
	const launch = JSON.parse(result.stdout);
	assert.equal(launch.scenarioId, 'note-resource-plugin');
	assert.match(launch.fixture.directorySha256, /^[a-f0-9]{64}$/);
	assert.deepEqual(
		launch.fixture.files.map(file => file.path),
		['index.js', 'manifest.json'],
	);
	assert.match(launch.harness.runnerSha256, /^[a-f0-9]{64}$/);
	assert.match(launch.harness.artifactScannerSha256, /^[a-f0-9]{64}$/);
	const fixtureSource = await readFile(join(launch.fixture.path, 'index.js'), 'utf8');
	assert.doesNotMatch(fixtureSource, /WT1-ISSUE37-(NOTE|RESOURCE|PLUGIN)-CANARY-20260723/);
	const configuration = await readFile(launch.configurationPath, 'utf8');
	assert.match(configuration, /-Scenario &quot;NoteResourcePlugin&quot;/);
});

test('artifact scanner records UTF-8 and UTF-16 canary locations without copying canary values', {
	skip: process.platform !== 'win32',
}, async () => {
	const artifactScannerPath = fileURLToPath(
		new URL('../../sandbox-trace/Get-WatchtowerSandboxArtifactManifest.ps1', import.meta.url),
	);
	const temporaryDirectory = await mkdtemp(join(tmpdir(), 'watchtower-sandbox-artifacts-'));
	const profileDirectory = join(temporaryDirectory, 'profile');
	const resourceDirectory = join(profileDirectory, 'resources');
	const pluginDataDirectory = join(
		profileDirectory,
		'plugin-data',
		'com.watchtower.packaged-content-trace',
	);
	const outputPath = join(temporaryDirectory, 'artifact-manifest.json');
	const resourceId = '12345678123456781234567812345678';
	const noteCanary = 'WT1-TEST-NOTE-CANARY';
	const resourceCanary = 'WT1-TEST-RESOURCE-CANARY';
	const pluginCanary = 'WT1-TEST-PLUGIN-CANARY';
	await mkdir(resourceDirectory, { recursive: true });
	await mkdir(pluginDataDirectory, { recursive: true });
	await writeFile(join(profileDirectory, 'database.sqlite'), `prefix ${noteCanary} suffix`, 'utf8');
	await writeFile(
		join(resourceDirectory, `${resourceId}.txt`),
		Buffer.from(resourceCanary, 'utf16le'),
	);
	await writeFile(join(profileDirectory, 'settings.json'), pluginCanary, 'utf8');
	await writeFile(join(pluginDataDirectory, 'plugin-data.txt'), pluginCanary, 'utf8');
	await writeFile(join(profileDirectory, 'empty.lock'), Buffer.alloc(0));

	const result = spawnSync('powershell.exe', [
		'-NoProfile',
		'-ExecutionPolicy',
		'Bypass',
		'-File',
		artifactScannerPath,
		'-RootPath',
		temporaryDirectory,
		'-OutputPath',
		outputPath,
		'-ScenarioId',
		'note-resource-plugin',
		'-RequireContentPersistence',
		'-ExpectedResourceId',
		resourceId,
		'-NoteCanary',
		noteCanary,
		'-ResourceCanary',
		resourceCanary,
		'-PluginCanary',
		pluginCanary,
	], { encoding: 'utf8' });

	assert.equal(result.status, 0, result.stderr);
	const output = await readFile(outputPath, 'utf8');
	assert.doesNotMatch(output, new RegExp(noteCanary));
	assert.doesNotMatch(output, new RegExp(resourceCanary));
	assert.doesNotMatch(output, new RegExp(pluginCanary));
	const manifest = JSON.parse(output);
	assert.equal(manifest.scenarioId, 'note-resource-plugin');
	assert.deepEqual(manifest.canaryIds, ['note', 'plugin', 'resource']);
	assert.deepEqual(
		manifest.files.filter(file => file.canaries.length).map(file => ({
			path: file.path,
			canaries: file.canaries,
		})),
		[
			{
				path: 'profile/database.sqlite',
				canaries: [{ id: 'note', encodings: ['utf8'] }],
			},
			{
				path: 'profile/plugin-data/com.watchtower.packaged-content-trace/plugin-data.txt',
				canaries: [{ id: 'plugin', encodings: ['utf8'] }],
			},
			{
				path: `profile/resources/${resourceId}.txt`,
				canaries: [{ id: 'resource', encodings: ['utf16le'] }],
			},
			{
				path: 'profile/settings.json',
				canaries: [{ id: 'plugin', encodings: ['utf8'] }],
			},
		],
	);
	assert.deepEqual(manifest.requiredPersistence, {
		noteDatabase: true,
		resourceStore: true,
		pluginSetting: true,
		pluginData: true,
		allPassed: true,
	});
	assert.deepEqual(manifest.errors, []);
});

test('artifact scanner rejects canary aliases when required persisted locations are missing', {
	skip: process.platform !== 'win32',
}, async () => {
	const artifactScannerPath = fileURLToPath(
		new URL('../../sandbox-trace/Get-WatchtowerSandboxArtifactManifest.ps1', import.meta.url),
	);
	const temporaryDirectory = await mkdtemp(join(tmpdir(), 'watchtower-sandbox-artifact-alias-'));
	const profileDirectory = join(temporaryDirectory, 'profile');
	const pluginDataDirectory = join(
		profileDirectory,
		'plugin-data',
		'com.watchtower.packaged-content-trace',
	);
	const outputPath = join(temporaryDirectory, 'artifact-manifest.json');
	const resourceId = '12345678123456781234567812345678';
	await mkdir(pluginDataDirectory, { recursive: true });
	await writeFile(join(profileDirectory, 'database.sqlite'), 'WT1-TEST-NOTE-CANARY', 'utf8');
	await writeFile(
		join(pluginDataDirectory, 'resource-input.txt'),
		'WT1-TEST-RESOURCE-CANARY',
		'utf8',
	);
	await writeFile(
		join(pluginDataDirectory, 'plugin-data.txt'),
		'WT1-TEST-PLUGIN-CANARY',
		'utf8',
	);

	const result = spawnSync('powershell.exe', [
		'-NoProfile',
		'-ExecutionPolicy',
		'Bypass',
		'-File',
		artifactScannerPath,
		'-RootPath',
		temporaryDirectory,
		'-OutputPath',
		outputPath,
		'-ScenarioId',
		'note-resource-plugin',
		'-RequireContentPersistence',
		'-ExpectedResourceId',
		resourceId,
		'-NoteCanary',
		'WT1-TEST-NOTE-CANARY',
		'-ResourceCanary',
		'WT1-TEST-RESOURCE-CANARY',
		'-PluginCanary',
		'WT1-TEST-PLUGIN-CANARY',
	], { encoding: 'utf8' });

	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /required content persistence locations/);
	const manifest = JSON.parse(await readFile(outputPath, 'utf8'));
	assert.deepEqual(manifest.requiredPersistence, {
		noteDatabase: true,
		resourceStore: false,
		pluginSetting: false,
		pluginData: true,
		allPassed: false,
	});
});

test('host launcher rejects an out-of-range trace duration before resolving inputs', {
	skip: process.platform !== 'win32',
}, () => {
	const result = spawnSync('powershell.exe', [
		'-NoProfile',
		'-ExecutionPolicy',
		'Bypass',
		'-File',
		launcherPath,
		'-ApplicationPath',
		'missing-application.exe',
		'-ProcmonPath',
		'missing-procmon.exe',
		'-EvidencePath',
		'missing-evidence',
		'-LabPath',
		'missing-lab',
		'-Mode',
		'Trace',
		'-TraceDurationSeconds',
		'5',
	], { encoding: 'utf8' });

	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /ValidateRange|TraceDurationSeconds/);
	assert.doesNotMatch(result.stderr, /Cannot find path/);
});

test('host launcher rejects an untrusted Procmon before launching Trace mode', {
	skip: process.platform !== 'win32',
}, async () => {
	const temporaryDirectory = await mkdtemp(join(tmpdir(), 'watchtower-sandbox-procmon-'));
	const applicationDirectory = join(temporaryDirectory, 'Application');
	const toolsDirectory = join(temporaryDirectory, 'Sysinternals');
	const evidenceDirectory = join(temporaryDirectory, 'Evidence');
	const labDirectory = join(temporaryDirectory, 'Lab');
	const applicationPath = join(applicationDirectory, 'Watchtower One.exe');
	const procmonPath = join(toolsDirectory, 'Procmon64.exe');
	await mkdir(applicationDirectory);
	await mkdir(toolsDirectory);
	await mkdir(evidenceDirectory);
	await writeFile(applicationPath, 'packaged-application');
	await writeFile(procmonPath, 'procmon');

	const result = spawnSync('powershell.exe', [
		'-NoProfile',
		'-ExecutionPolicy',
		'Bypass',
		'-File',
		launcherPath,
		'-ApplicationPath',
		applicationPath,
		'-ProcmonPath',
		procmonPath,
		'-EvidencePath',
		evidenceDirectory,
		'-LabPath',
		labDirectory,
		'-Mode',
		'Trace',
		'-ExpectedApplicationSha256',
		'bbdd26890973472bbeec0ec33240dbafc18b5bf058c51de9d6b0471a56feb528',
		'-ExpectedProcmonSha256',
		'd86580392e249926e944c40917377c0428bb1afc300fe31d4d321900da973495',
	], { encoding: 'utf8' });

	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /Authenticode-valid Microsoft Sysinternals Procmon/);
	await assert.rejects(access(labDirectory), { code: 'ENOENT' });
});

test('host launcher rejects a Trace input that does not match its expected hash', {
	skip: process.platform !== 'win32',
}, async () => {
	const temporaryDirectory = await mkdtemp(join(tmpdir(), 'watchtower-sandbox-hash-'));
	const applicationDirectory = join(temporaryDirectory, 'Application');
	const toolsDirectory = join(temporaryDirectory, 'Sysinternals');
	const evidenceDirectory = join(temporaryDirectory, 'Evidence');
	const labDirectory = join(temporaryDirectory, 'Lab');
	const applicationPath = join(applicationDirectory, 'Watchtower One.exe');
	const procmonPath = join(toolsDirectory, 'Procmon64.exe');
	await mkdir(applicationDirectory);
	await mkdir(toolsDirectory);
	await mkdir(evidenceDirectory);
	await writeFile(applicationPath, 'packaged-application');
	await writeFile(procmonPath, 'procmon');

	const result = spawnSync('powershell.exe', [
		'-NoProfile',
		'-ExecutionPolicy',
		'Bypass',
		'-File',
		launcherPath,
		'-ApplicationPath',
		applicationPath,
		'-ProcmonPath',
		procmonPath,
		'-EvidencePath',
		evidenceDirectory,
		'-LabPath',
		labDirectory,
		'-Mode',
		'Trace',
		'-ExpectedApplicationSha256',
		'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
		'-ExpectedProcmonSha256',
		'd86580392e249926e944c40917377c0428bb1afc300fe31d4d321900da973495',
		'-PrepareOnly',
	], { encoding: 'utf8' });

	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /ApplicationPath SHA-256 does not match/);
	await assert.rejects(access(labDirectory), { code: 'ENOENT' });
});

test('host launcher rejects a lab directory inside an input without creating it', {
	skip: process.platform !== 'win32',
}, async () => {
	const temporaryDirectory = await mkdtemp(join(tmpdir(), 'watchtower-sandbox-lab-overlap-'));
	const applicationDirectory = join(temporaryDirectory, 'Application');
	const toolsDirectory = join(temporaryDirectory, 'Sysinternals');
	const evidenceDirectory = join(temporaryDirectory, 'Evidence');
	const labDirectory = join(applicationDirectory, 'Lab');
	const applicationPath = join(applicationDirectory, 'Watchtower One.exe');
	const procmonPath = join(toolsDirectory, 'Procmon64.exe');
	await mkdir(applicationDirectory);
	await mkdir(toolsDirectory);
	await mkdir(evidenceDirectory);
	await writeFile(applicationPath, 'packaged-application');
	await writeFile(procmonPath, 'procmon');

	const result = spawnSync('powershell.exe', [
		'-NoProfile',
		'-ExecutionPolicy',
		'Bypass',
		'-File',
		launcherPath,
		'-ApplicationPath',
		applicationPath,
		'-ProcmonPath',
		procmonPath,
		'-EvidencePath',
		evidenceDirectory,
		'-LabPath',
		labDirectory,
		'-PrepareOnly',
	], { encoding: 'utf8' });

	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /LabPath must not overlap/);
	await assert.rejects(access(labDirectory), { code: 'ENOENT' });
});
