import PreProfileVaultBootstrap, {
	ProfileHost,
	VaultSessionCapability,
} from '../vault/PreProfileVaultBootstrap';
import Database from '@joplin/lib/database';
import JoplinDatabase from '@joplin/lib/JoplinDatabase';
import EncryptedProfileStorage from './EncryptedProfileStorage';
import {
	EncryptedProfileConnection,
	maximumResourceContentBytes,
	maximumSyncCiphertextBytes,
} from './profileStorageTypes';

const { DatabaseDriverNode } = require('@joplin/lib/database-driver-node.js');

const makeConnection = (): EncryptedProfileConnection => {
	let closed = false;
	return {
		selectOne: async (sql) => {
			if (closed) throw new Error('closed');
			return sql === 'SELECT body FROM notes WHERE id = ?' ?
				{ body: 'profile-storage-canary' } : undefined;
		},
		selectAll: async () => [],
		exec: async () => {
			if (closed) throw new Error('closed');
		},
		close: async () => {
			closed = true;
		},
		terminate: () => {
			closed = true;
			return true;
		},
	};
};

describe('EncryptedProfileStorage', () => {

	test('ordinary profile database work is available only during an active Vault Session', async () => {
		const storage = new EncryptedProfileStorage(makeConnection());
		let capability: VaultSessionCapability|undefined;
		const profileHost: ProfileHost = {
			start: async sessionCapability => {
				capability = sessionCapability;
			},
			stop: async () => ({ kind: 'stopped' }),
			terminate: () => true,
		};
		const lifecycle = new PreProfileVaultBootstrap({
			create: async () => ({ kind: 'opened', handle: storage }),
			unlock: async () => ({ kind: 'opened', handle: storage }),
			recover: async () => ({ kind: 'opened', handle: storage }),
			abort: () => true,
		});

		await expect(lifecycle.start('unlock', profileHost)).resolves.toEqual({ kind: 'unlocked' });

		const database = storage.database(capability!);
		await database.open({ name: 'watchtower-profile' });
		await database.exec(
			'INSERT INTO notes (id, body) VALUES (?, ?)',
			['watchtower-note', 'profile-storage-canary'],
		);
		await expect(database.selectOne(
			'SELECT body FROM notes WHERE id = ?',
			['watchtower-note'],
		)).resolves.toEqual({ body: 'profile-storage-canary' });

		await expect(lifecycle.end('lock')).resolves.toEqual({ kind: 'locked' });
		await expect(database.selectOne(
			'SELECT body FROM notes WHERE id = ?',
			['watchtower-note'],
		)).rejects.toThrow('Vault Session is not active');
	});

	test('the storage database preserves Joplin database-driver behavior without exposing its physical path', async () => {
		const storage = new EncryptedProfileStorage(makeConnection());
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

		const database = new Database(storage.database(capability!));
		await expect(database.open({ name: 'watchtower-profile' })).resolves.toBeUndefined();
		await database.exec(
			'INSERT INTO notes (id, body) VALUES (?, ?)',
			['watchtower-note', 'profile-storage-canary'],
		);
		await expect(database.selectOne(
			'SELECT body FROM notes WHERE id = ?',
			['watchtower-note'],
		)).resolves.toEqual({ body: 'profile-storage-canary' });
		await expect(database.close()).resolves.toBeUndefined();
		await expect(lifecycle.end('close')).resolves.toEqual({ kind: 'locked' });
	});

	test('resource bytes round-trip through encrypted profile storage without a persistent plaintext path', async () => {
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

		const resources = storage.resources(capability!);
		const resourceId = '0123456789abcdef0123456789abcdef';
		const content = Buffer.from('watchtower-resource-content-canary');
		await resources.import(resourceId, content, 'content', `${resourceId}.bin`);

		await expect(resources.read(resourceId)).resolves.toEqual(content);
		await expect(resources.metadata(resourceId)).resolves.toEqual(
			expect.objectContaining({
				fileName: `${resourceId}.bin`,
				kind: 'content',
				resourceId,
				size: content.byteLength,
			}),
		);
		await expect(resources.import(
			resourceId,
			content,
			'not-a-content-kind' as never,
		)).rejects.toThrow('Resource content kind is invalid');
		await resources.remove(resourceId);
		await expect(resources.read(resourceId)).rejects.toThrow('Resource content is unavailable');
		await expect(lifecycle.end('close')).resolves.toEqual({ kind: 'locked' });
	});

	test('joplin sync ciphertext remains separate from canonical resource content', async () => {
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

		const resources = storage.resources(capability!);
		const resourceId = 'fedcba9876543210fedcba9876543210';
		await resources.import(resourceId, Buffer.from('decrypted-content'), 'content');
		await resources.import(resourceId, Buffer.from('joplin-e2ee-ciphertext'), 'syncCiphertext');

		await expect(resources.read(resourceId, 'content')).resolves.toEqual(
			Buffer.from('decrypted-content'),
		);
		await expect(resources.read(resourceId, 'syncCiphertext')).resolves.toEqual(
			Buffer.from('joplin-e2ee-ciphertext'),
		);
		await resources.remove(resourceId, 'syncCiphertext');
		await expect(resources.read(resourceId, 'content')).resolves.toEqual(
			Buffer.from('decrypted-content'),
		);
		await expect(lifecycle.end('close')).resolves.toEqual({ kind: 'locked' });
	});

	test('sync ciphertext allows Joplin encryption overhead beyond the canonical resource limit', () => {
		expect(maximumSyncCiphertextBytes).toBeGreaterThan(maximumResourceContentBytes);
	});

	test('sensitive settings and curated-plugin data remain isolated inside profile storage', async () => {
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

		const privateData = storage.privateData(capability!);
		await privateData.write(
			'settings',
			'editor.preferences',
			Buffer.from('watchtower-sensitive-setting-canary'),
		);
		await privateData.write(
			'plugin:watchtower.example',
			'preferences',
			Buffer.from('watchtower-plugin-data-canary'),
		);

		await expect(privateData.read('settings', 'editor.preferences')).resolves.toEqual(
			Buffer.from('watchtower-sensitive-setting-canary'),
		);
		await expect(privateData.read('plugin:watchtower.example', 'preferences')).resolves.toEqual(
			Buffer.from('watchtower-plugin-data-canary'),
		);
		await expect(privateData.read('settings', 'preferences')).resolves.toBeUndefined();
		await expect(lifecycle.end('close')).resolves.toEqual({ kind: 'locked' });
	});

	test('the current Joplin schema migrates through the encrypted profile database seam', async () => {
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

		const database = new JoplinDatabase(storage.database(capability!));
		await database.open({ name: 'watchtower-profile' });
		expect(database.version()).toBe(49);
		await database.exec(
			'INSERT INTO notes (id, parent_id, title, body, created_time, updated_time) VALUES (?, ?, ?, ?, ?, ?)',
			['watchtower-note', '', 'Watchtower', 'encrypted-profile-canary', 1, 1],
		);
		await expect(database.selectOne(
			'SELECT body FROM notes WHERE id = ?',
			['watchtower-note'],
		)).resolves.toEqual({ body: 'encrypted-profile-canary' });

		await database.close();
		await expect(lifecycle.end('close')).resolves.toEqual({ kind: 'locked' });
	});

	test('cache, log, Electron-state, and temporary artifacts are session-memory only', async () => {
		const storage = new EncryptedProfileStorage(makeConnection());
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

		const runtime = storage.ephemeral(capability!);
		for (const category of ['cache', 'log', 'electronState', 'temporary'] as const) {
			await runtime.write(
				category,
				'probe',
				Buffer.from(`watchtower-${category}-canary`),
			);
			await expect(runtime.read(category, 'probe')).resolves.toEqual(
				Buffer.from(`watchtower-${category}-canary`),
			);
		}
		await expect(runtime.write(
			'publicDisk' as never,
			'probe',
			Buffer.from('plaintext-bypass'),
		)).rejects.toThrow('Ephemeral profile artifact address is invalid');

		await expect(lifecycle.end('lock')).resolves.toEqual({ kind: 'locked' });
		await expect(runtime.read('cache', 'probe')).rejects.toThrow('Vault Session is not active');
	});

});
