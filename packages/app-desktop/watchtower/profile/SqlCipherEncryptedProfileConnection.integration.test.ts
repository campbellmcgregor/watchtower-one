import JoplinDatabase from '@joplin/lib/JoplinDatabase';
// cspell:ignore SIGNALAPP SQLCIPHER signalapp sqlcipher
import { randomBytes } from 'crypto';
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
} from 'fs';
import { tmpdir } from 'os';
import { basename, dirname, join } from 'path';
import PreProfileVaultBootstrap, {
	VaultSessionCapability,
} from '../vault/PreProfileVaultBootstrap';
import EncryptedProfileStorage from './EncryptedProfileStorage';
import EncryptedResourceFsDriver from './EncryptedResourceFsDriver';
import SqlCipherEncryptedProfileConnection from './SqlCipherEncryptedProfileConnection';
import {
	SqlCipherNativeDatabase,
} from './sqlCipherProfileTypes';

const compatibilityPrebuildRoot = process.env.WATCHTOWER_SQLCIPHER_PREBUILD_ROOT;
const sqlCipherTest = compatibilityPrebuildRoot ? test : test.skip;

const noteCanary = 'WATCHTOWER_PROFILE_NOTE_CANARY_7A1B2C3D';
const resourceCanary = 'WATCHTOWER_PROFILE_RESOURCE_CANARY_8B2C3D4E';
const settingCanary = 'WATCHTOWER_PROFILE_SETTING_CANARY_9C3D4E5F';

const rawKeyPragma = (key: Buffer) => `key = "x'${key.toString('hex')}'"`;

const openNativeDatabase = (databasePath: string, key: Buffer): SqlCipherNativeDatabase => {
	process.env['@SIGNALAPP/SQLCIPHER_PREBUILD'] = compatibilityPrebuildRoot!;
	// eslint-disable-next-line @typescript-eslint/no-var-requires -- Must be loaded after selecting the verified prebuild.
	const sqlCipherBinding = require('@signalapp/sqlcipher');
	sqlCipherBinding.setLogger(() => {});
	const SqlCipherDatabase = sqlCipherBinding.default;
	const database = new SqlCipherDatabase(databasePath);
	database.pragma(rawKeyPragma(key));
	return database;
};

const startStorage = async (databasePath: string, key: Buffer) => {
	const connection = await SqlCipherEncryptedProfileConnection.verify(
		openNativeDatabase(databasePath, key),
	);
	const storage = new EncryptedProfileStorage(connection);
	let capability: VaultSessionCapability|undefined;
	const lifecycle = new PreProfileVaultBootstrap({
		create: async () => ({ kind: 'opened', handle: storage }),
		unlock: async () => ({ kind: 'opened', handle: storage }),
		recover: async () => ({ kind: 'opened', handle: storage }),
		abort: () => true,
	});
	await lifecycle.start('unlock', {
		start: async sessionCapability => {
			capability = sessionCapability;
		},
		stop: async () => ({ kind: 'stopped' }),
		terminate: () => true,
	});
	return { capability: capability!, lifecycle, storage };
};

const scanDatabaseArtifacts = (databasePath: string) => {
	const databaseName = basename(databasePath);
	return readdirSync(dirname(databasePath))
		.filter(filename => filename.startsWith(databaseName))
		.map(filename => join(dirname(databasePath), filename))
		.filter(path => statSync(path).isFile())
		.flatMap(path => {
			const bytes = readFileSync(path);
			return [noteCanary, resourceCanary, settingCanary]
				.filter(canary => bytes.includes(Buffer.from(canary)))
				.map(canary => ({ path, canary }));
		});
};

sqlCipherTest('Joplin profile data survives an encrypted SQLCipher close and restart without plaintext artifacts', async () => {
	const scratchRoot = mkdtempSync(join(tmpdir(), 'WatchtowerOne-ProfileStorage-'));
	const databasePath = join(scratchRoot, 'profile.sqlite');
	const resourceDirectory = join(scratchRoot, 'virtual-resources');
	const resourcePath = join(
		resourceDirectory,
		'0123456789abcdef0123456789abcdef.bin',
	);
	const key = randomBytes(32);
	let opened: Awaited<ReturnType<typeof startStorage>>|undefined;
	try {
		opened = await startStorage(databasePath, key);
		let database = new JoplinDatabase(opened.storage.database(opened.capability));
		await database.open({ name: 'watchtower-profile' });
		await database.exec(
			'INSERT INTO notes (id, parent_id, title, body, created_time, updated_time) VALUES (?, ?, ?, ?, ?, ?)',
			['watchtower-note', '', 'Watchtower', noteCanary, 1, 1],
		);
		let resourceFileSystem = new EncryptedResourceFsDriver(
			resourceDirectory,
			opened.storage.resources(opened.capability),
		);
		await resourceFileSystem.writeFile(
			resourcePath,
			Buffer.from(resourceCanary),
			'buffer',
		);
		expect(existsSync(resourceDirectory)).toBe(false);
		await opened.storage.privateData(opened.capability).write(
			'settings',
			'sync.credentials',
			Buffer.from(settingCanary),
		);
		await database.close();
		await opened.lifecycle.end('close');

		expect(scanDatabaseArtifacts(databasePath)).toEqual([]);

		opened = await startStorage(databasePath, key);
		database = new JoplinDatabase(opened.storage.database(opened.capability));
		await database.open({ name: 'watchtower-profile' });
		await expect(database.selectOne(
			'SELECT body FROM notes WHERE id = ?',
			['watchtower-note'],
		)).resolves.toEqual({ body: noteCanary });
		resourceFileSystem = new EncryptedResourceFsDriver(
			resourceDirectory,
			opened.storage.resources(opened.capability),
		);
		await expect(resourceFileSystem.readFile(resourcePath, 'Buffer')).resolves.toEqual(
			Buffer.from(resourceCanary),
		);
		expect(existsSync(resourceDirectory)).toBe(false);
		await expect(opened.storage.privateData(opened.capability).read(
			'settings',
			'sync.credentials',
		)).resolves.toEqual(Buffer.from(settingCanary));
		await database.close();
		await opened.lifecycle.end('close');

		expect(scanDatabaseArtifacts(databasePath)).toEqual([]);
	} finally {
		if (opened?.lifecycle.state() === 'unlocked') {
			await opened.lifecycle.end('close');
		}
		key.fill(0);
		try {
			rmSync(scratchRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
		} catch {
			// Windows can retain a native addon handle briefly; the OS temp
			// directory remains outside the repository and is safe to retry later.
		}
	}
});
