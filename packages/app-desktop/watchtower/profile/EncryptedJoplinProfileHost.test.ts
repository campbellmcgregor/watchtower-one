import PreProfileVaultBootstrap from '../vault/PreProfileVaultBootstrap';
import EncryptedProfileStorage from './EncryptedProfileStorage';
import EncryptedJoplinProfileHost from './EncryptedJoplinProfileHost';
import {
	JoplinProfileRuntime,
} from './joplinProfileTypes';

const { DatabaseDriverNode } = require('@joplin/lib/database-driver-node.js');

describe('EncryptedJoplinProfileHost', () => {

	test('joplin loads only after the vault supplies capability-scoped profile storage', async () => {
		const events: string[] = [];
		const sqlite = new DatabaseDriverNode();
		await sqlite.open({ name: ':memory:' });
		const storage = new EncryptedProfileStorage({
			selectOne: (sql, params) => sqlite.selectOne(sql, params),
			selectAll: (sql, params) => sqlite.selectAll(sql, params),
			exec: (sql, params) => sqlite.exec(sql, params),
			close: async () => {
				events.push('storage-closed');
				await sqlite.close();
			},
			terminate: () => false,
		});
		let activeProfile: Parameters<JoplinProfileRuntime['start']>[0]|undefined;
		const runtime: JoplinProfileRuntime = {
			start: async profile => {
				activeProfile = profile;
				events.push('joplin-started');
				expect(profile.ephemeralRuntime.partition()).toMatch(/^watchtower-session-/);
				events.push('ephemeral-session-active');
				await profile.resourceFileSystem.writeFile(
					'C:\\WatchtowerVirtualProfile\\resources\\0123456789abcdef0123456789abcdef.md',
					Buffer.from('resource-through-joplin-adapter'),
					'buffer',
				);
				events.push(String(await profile.resourceFileSystem.readFile(
					'C:\\WatchtowerVirtualProfile\\resources\\0123456789abcdef0123456789abcdef.md',
					'utf8',
				)));
				await profile.database.exec(
					'CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT NOT NULL)',
				);
				await profile.database.exec(
					'INSERT INTO notes (id, body) VALUES (?, ?)',
					['watchtower-note', 'encrypted-profile-canary'],
				);
				const note = await profile.database.selectOne(
					'SELECT body FROM notes WHERE id = ?',
					['watchtower-note'],
				);
				events.push(String(note?.body));
			},
			stop: async () => {
				await activeProfile!.database.exec(
					'UPDATE notes SET body = ? WHERE id = ?',
					['encrypted-profile-stop-canary', 'watchtower-note'],
				);
				const note = await activeProfile!.database.selectOne(
					'SELECT body FROM notes WHERE id = ?',
					['watchtower-note'],
				);
				events.push(String(note?.body));
				events.push('joplin-stopped');
				return { kind: 'stopped' };
			},
			terminate: () => true,
		};
		const profileHost = new EncryptedJoplinProfileHost(
			() => storage,
			async () => {
				events.push('joplin-loaded');
				return runtime;
			},
			{
				ephemeralSessionFactory: {
					fromPartition: async () => ({
						storagePath: null,
						clearCache: async () => {
							events.push('ephemeral-cache-cleared');
						},
						clearStorageData: async () => {
							events.push('ephemeral-storage-cleared');
						},
						closeAllConnections: async () => {
							events.push('ephemeral-connections-closed');
						},
					}),
				},
				resourceDirectory: 'C:\\WatchtowerVirtualProfile\\resources',
			},
		);
		const lifecycle = new PreProfileVaultBootstrap({
			create: async () => ({ kind: 'opened', handle: storage }),
			unlock: async () => {
				events.push('vault-opened');
				return { kind: 'opened', handle: storage };
			},
			recover: async () => ({ kind: 'opened', handle: storage }),
			abort: () => true,
		});

		expect(events).toEqual([]);
		await expect(lifecycle.start('unlock', profileHost)).resolves.toEqual({ kind: 'unlocked' });
		expect(events).toEqual([
			'vault-opened',
			'joplin-loaded',
			'joplin-started',
			'ephemeral-session-active',
			'resource-through-joplin-adapter',
			'encrypted-profile-canary',
		]);

		await expect(lifecycle.end('close')).resolves.toEqual({ kind: 'locked' });
		expect(events).toEqual([
			'vault-opened',
			'joplin-loaded',
			'joplin-started',
			'ephemeral-session-active',
			'resource-through-joplin-adapter',
			'encrypted-profile-canary',
			'encrypted-profile-stop-canary',
			'joplin-stopped',
			'ephemeral-connections-closed',
			'ephemeral-storage-cleared',
			'ephemeral-cache-cleared',
			'storage-closed',
		]);
	});

});
