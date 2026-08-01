import PreProfileVaultBootstrap from '../vault/PreProfileVaultBootstrap';
import EncryptedProfileStorage from './EncryptedProfileStorage';
import EncryptedJoplinProfileHost from './EncryptedJoplinProfileHost';
import openProfileDatabase from '@joplin/lib/openProfileDatabase';
import JoplinDatabase from '@joplin/lib/JoplinDatabase';
import Logger from '@joplin/utils/Logger';
import bindJoplinProfileStorage from './bindJoplinProfileStorage';
import resolveProfileStorageBinding from '@joplin/lib/profileStorageBinding';
import Resource from '@joplin/lib/models/Resource';
import EncryptionService from '@joplin/lib/services/e2ee/EncryptionService';
import {
	JoplinProfileRuntime,
} from './joplinProfileTypes';
import type { Session } from 'electron';
import type { ProfileRuntimeFileSystem } from '@joplin/lib/profileStorageBinding';

const { DatabaseDriverNode } = require('@joplin/lib/database-driver-node.js');

describe('EncryptedJoplinProfileHost', () => {

	test('joplin loads only after the vault supplies capability-scoped profile storage', async () => {
		const events: string[] = [];
		const browserSession = {} as Session;
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
		let activeDatabase: JoplinDatabase|undefined;
		let temporaryPath = '';
		let runtimeFileSystem: ProfileRuntimeFileSystem|undefined;
		const runtime: JoplinProfileRuntime = {
			start: async profile => {
				const binding = bindJoplinProfileStorage(profile);
				expect(binding.pluginCode).toEqual({
					cacheDirectory: 'C:\\WatchtowerPublicCode\\plugins\\cache',
					packageDirectory: 'C:\\WatchtowerPublicCode\\plugins\\packages',
				});
				expect(binding.publicVaultLockFilePath).toBe(
					'C:\\WatchtowerPublicRuntime\\vault.lock',
				);
				const resolvedStorage = resolveProfileStorageBinding(binding, () => {
					throw new Error('stock profile storage must remain unavailable');
				});
				runtimeFileSystem = binding.runtimeFileSystem;
				temporaryPath = `${runtimeFileSystem.temporaryDirectory()}/preview/note.html`;
				await runtimeFileSystem.mkdir(`${runtimeFileSystem.temporaryDirectory()}/preview`);
				await runtimeFileSystem.writeFile(
					temporaryPath,
					'<h1>ephemeral-profile-canary</h1>',
					'utf8',
				);
				events.push(String(await runtimeFileSystem.readFile(temporaryPath, 'utf8')));
				expect(EncryptionService.fsDriver_).toBe(Resource.fsDriver());
				activeDatabase = await openProfileDatabase({
					binding: resolvedStorage.database,
					logger: new Logger(),
				});
				events.push('joplin-started');
				expect(profile.ephemeralRuntime.partition()).toMatch(/^watchtower-session-/);
				events.push('ephemeral-session-active');
				await Resource.fsDriver().writeFile(
					'C:\\WatchtowerVirtualProfile\\resources\\0123456789abcdef0123456789abcdef.md',
					Buffer.from('resource-through-joplin-adapter'),
					'buffer',
				);
				events.push(String(await Resource.fsDriver().readFile(
					'C:\\WatchtowerVirtualProfile\\resources\\0123456789abcdef0123456789abcdef.md',
					'utf8',
				)));
				await activeDatabase.exec(
					'INSERT INTO notes (id, parent_id, title, body, created_time, updated_time) VALUES (?, ?, ?, ?, ?, ?)',
					['watchtower-note', '', 'Watchtower', 'encrypted-profile-canary', 1, 1],
				);
				const note = await activeDatabase.selectOne(
					'SELECT body FROM notes WHERE id = ?',
					['watchtower-note'],
				);
				events.push(String(note?.body));
			},
			stop: async () => {
				await activeDatabase!.exec(
					'UPDATE notes SET body = ? WHERE id = ?',
					['encrypted-profile-stop-canary', 'watchtower-note'],
				);
				const note = await activeDatabase!.selectOne(
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
						browserSession,
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
				pluginCode: {
					cacheDirectory: 'C:\\WatchtowerPublicCode\\plugins\\cache',
					packageDirectory: 'C:\\WatchtowerPublicCode\\plugins\\packages',
				},
				publicVaultLockFilePath: 'C:\\WatchtowerPublicRuntime\\vault.lock',
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
		const startResult = await lifecycle.start('unlock', profileHost);
		expect(events).toEqual([
			'vault-opened',
			'joplin-loaded',
			'<h1>ephemeral-profile-canary</h1>',
			'joplin-started',
			'ephemeral-session-active',
			'resource-through-joplin-adapter',
			'encrypted-profile-canary',
		]);
		expect(startResult).toEqual({ kind: 'unlocked' });

		await expect(lifecycle.end('close')).resolves.toEqual({ kind: 'locked' });
		expect(events).toEqual([
			'vault-opened',
			'joplin-loaded',
			'<h1>ephemeral-profile-canary</h1>',
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
		await expect(runtimeFileSystem!.readFile(temporaryPath, 'utf8')).rejects.toThrow(
			'Vault Session',
		);
	});

});
