/**
 * @jest-environment node
 */

import { join } from 'path';
import PreProfileVaultBootstrap, {
	VaultSessionCapability,
} from '../vault/PreProfileVaultBootstrap';
import EncryptedProfileStorage from './EncryptedProfileStorage';
import EncryptedResourceFsDriver from './EncryptedResourceFsDriver';
import EncryptionService, {
	EncryptionMethod,
} from '@joplin/lib/services/e2ee/EncryptionService';
import MasterKey from '@joplin/lib/models/MasterKey';
import Resource from '@joplin/lib/models/Resource';
import {
	setupDatabaseAndSynchronizer,
	switchClient,
} from '@joplin/lib/testing/test-utils';
import bindJoplinProfileStorage from './bindJoplinProfileStorage';
import resolveProfileStorageBinding from '@joplin/lib/profileStorageBinding';

const { DatabaseDriverNode } = require('@joplin/lib/database-driver-node.js');

describe('EncryptedResourceFsDriver', () => {

	test('joplin resource file operations use encrypted content records instead of durable paths', async () => {
		const sqlite = new DatabaseDriverNode();
		await sqlite.open({ name: ':memory:' });
		const storage = new EncryptedProfileStorage({
			selectOne: (sql, params) => sqlite.selectOne(sql, params),
			selectAll: (sql, params) => sqlite.selectAll(sql, params),
			exec: (sql, params) => sqlite.exec(sql, params),
			close: async () => sqlite.close(),
			terminate: () => false,
		});
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

		const resourceDirectory = join('C:\\WatchtowerVirtualProfile', 'resources');
		const driver = new EncryptedResourceFsDriver(
			resourceDirectory,
			storage.resources(capability!),
		);
		const resourceId = '0123456789abcdef0123456789abcdef';
		const contentPath = join(resourceDirectory, `${resourceId}.png`);
		const syncPath = join(resourceDirectory, `${resourceId}.crypted`);
		const differentlyCasedContentPath = contentPath.replace(
			'WatchtowerVirtualProfile',
			'WatchtowerVirtualProfile'.toUpperCase(),
		);

		await driver.writeFile(contentPath, Buffer.from('resource-content'), 'buffer');
		await driver.writeFile(syncPath, Buffer.from('sync-ciphertext'), 'buffer');
		await expect(driver.readFile(contentPath, 'Buffer')).resolves.toEqual(
			Buffer.from('resource-content'),
		);
		await expect(driver.readFile(syncPath, 'Buffer')).resolves.toEqual(
			Buffer.from('sync-ciphertext'),
		);
		await expect(driver.exists(contentPath)).resolves.toBe(true);
		await expect(driver.stat(contentPath)).resolves.toEqual(
			expect.objectContaining({ path: contentPath, size: 16 }),
		);
		await driver.writeFile(
			differentlyCasedContentPath,
			Buffer.from('case-insensitive-resource-content'),
			'buffer',
		);
		await expect(driver.readFile(contentPath, 'utf8')).resolves.toBe(
			'case-insensitive-resource-content',
		);
		await driver.writeFile(contentPath, Buffer.from('resource-content'), 'buffer');
		await expect(driver.copy(contentPath, 'C:\\outside\\resource.png')).rejects.toThrow(
			'Explicit Plaintext Egress',
		);
		await expect(driver.writeFile(
			join(resourceDirectory, 'not-a-resource.txt'),
			'plaintext-bypass',
			'utf8',
		)).rejects.toThrow('Encrypted resource path is invalid');
		await expect(driver.mkdir(
			join(resourceDirectory, 'plaintext-subdirectory'),
		)).rejects.toThrow('Encrypted resource path is invalid');
		await expect(driver.readDirStats(
			join(resourceDirectory, 'plaintext-subdirectory'),
		)).rejects.toThrow('Encrypted resource path is invalid');
		await expect(driver.mkdir(contentPath)).rejects.toThrow(
			'Encrypted resource path is invalid',
		);
		await expect(driver.readDirStats(contentPath)).rejects.toThrow(
			'Encrypted resource path is invalid',
		);
		expect(() => driver.appendFileSync(
			join(resourceDirectory, 'plaintext-subdirectory', 'bypass.txt'),
			'plaintext-bypass',
		)).toThrow('Encrypted resource path is invalid');

		const handle = await driver.open(contentPath, 'r');
		await expect(driver.readFileChunk(handle, 8, 'base64')).resolves.toBe(
			Buffer.from('resource').toString('base64'),
		);
		await expect(driver.readFileChunk(handle, 8, 'ascii')).resolves.toBe('-content');
		await expect(driver.readFileChunk(handle, 8, 'base64')).resolves.toBeNull();
		await driver.close(handle);

		await driver.unlink(syncPath);
		await driver.appendFile(syncPath, Buffer.from('sync-').toString('base64'), 'base64');
		await driver.appendFile(syncPath, Buffer.from('ciphertext').toString('base64'), 'base64');
		await expect(driver.readFile(syncPath, 'utf8')).resolves.toBe('sync-ciphertext');
		await expect(driver.readDirStats(resourceDirectory)).resolves.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ path: `${resourceId}.png`, size: 16 }),
				expect.objectContaining({ path: `${resourceId}.crypted`, size: 15 }),
			]),
		);

		await driver.remove(contentPath);
		await expect(driver.exists(contentPath)).resolves.toBe(false);
		await expect(lifecycle.end('close')).resolves.toEqual({ kind: 'locked' });
	});

	test('joplin sync E2EE streams canonical resources to isolated sync ciphertext and back', async () => {
		await setupDatabaseAndSynchronizer(1);
		await switchClient(1);

		const sqlite = new DatabaseDriverNode();
		await sqlite.open({ name: ':memory:' });
		const storage = new EncryptedProfileStorage({
			selectOne: (sql, params) => sqlite.selectOne(sql, params),
			selectAll: (sql, params) => sqlite.selectAll(sql, params),
			exec: (sql, params) => sqlite.exec(sql, params),
			close: async () => sqlite.close(),
			terminate: () => false,
		});
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

		const resourceDirectory = join('C:\\WatchtowerVirtualProfile', 'resources');
		const driver = new EncryptedResourceFsDriver(
			resourceDirectory,
			storage.resources(capability!),
		);
		const resourceId = 'fedcba9876543210fedcba9876543210';
		const contentPath = join(resourceDirectory, `${resourceId}.bin`);
		const syncPath = join(resourceDirectory, `${resourceId}.crypted`);
		const content = Buffer.from('resource-sync-round-trip-canary');
		await driver.writeFile(contentPath, content, 'buffer');

		const encryptionService = new EncryptionService();
		const previousFsDriver = EncryptionService.fsDriver_;
		const previousResourceFsDriver = Resource.fsDriver_;
		const binding = bindJoplinProfileStorage({
			database: storage.database(capability!),
			resourceFileSystem: driver,
		});
		resolveProfileStorageBinding(binding, () => {
			throw new Error('stock profile storage must remain unavailable');
		});
		try {
			const resource = await Resource.save({
				id: resourceId,
				mime: 'application/octet-stream',
			}, { isNew: true });
			await expect(Resource.content(resource)).resolves.toEqual(content);

			encryptionService.defaultFileEncryptionMethod_ = EncryptionMethod.SJCL1b;
			let masterKey = await encryptionService.generateMasterKey(
				'watchtower-test-password',
				{ encryptionMethod: EncryptionMethod.SJCL1b },
			);
			masterKey = await MasterKey.save(masterKey);
			await encryptionService.loadMasterKey(
				masterKey,
				'watchtower-test-password',
				true,
			);

			await encryptionService.encryptFile(contentPath, syncPath);
			await expect(driver.readFile(syncPath, 'Buffer')).resolves.not.toEqual(content);
			await driver.unlink(contentPath);
			await encryptionService.decryptFile(syncPath, contentPath);
			await expect(driver.readFile(contentPath, 'Buffer')).resolves.toEqual(content);
		} finally {
			EncryptionService.fsDriver_ = previousFsDriver;
			Resource.fsDriver_ = previousResourceFsDriver;
		}

		await expect(lifecycle.end('close')).resolves.toEqual({ kind: 'locked' });
	});

});
