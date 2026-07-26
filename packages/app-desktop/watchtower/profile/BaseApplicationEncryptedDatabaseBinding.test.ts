import openProfileDatabase from '@joplin/lib/openProfileDatabase';
import Logger from '@joplin/utils/Logger';
import { EncryptedProfileDatabase } from './profileStorageTypes';

describe('BaseApplication encrypted database binding', () => {
	test('ordinary Joplin database startup opens the authorised logical profile database', async () => {
		const openedNames: string[] = [];
		const databaseDriver: EncryptedProfileDatabase = {
			open: async options => {
				openedNames.push(options.name);
				throw new Error('stop after observing the profile database');
			},
			close: async () => {},
			exec: async () => {},
			selectAll: async () => [],
			selectOne: async () => undefined,
			sqliteErrorToJsError: error => error instanceof Error ? error : new Error(String(error)),
		};

		await expect(openProfileDatabase({
			binding: {
				driver: databaseDriver,
				name: 'watchtower-profile',
			},
			logger: new Logger(),
		})).rejects.toThrow('stop after observing the profile database');

		expect(openedNames).toEqual(['watchtower-profile']);
	});
});
