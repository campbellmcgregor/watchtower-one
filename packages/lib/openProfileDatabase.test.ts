import Logger from '@joplin/utils/Logger';
import openProfileDatabase, {
	selectProfileDatabaseBinding,
} from './openProfileDatabase';

const { DatabaseDriverNode } = require('./database-driver-node.js');

describe('openProfileDatabase', () => {
	test('opens a supplied database binding through ordinary Joplin queries', async () => {
		const database = await openProfileDatabase({
			binding: {
				driver: new DatabaseDriverNode(),
				name: ':memory:',
			},
			logger: new Logger(),
		});

		try {
			await database.exec('CREATE TABLE binding_proof (value TEXT NOT NULL)');
			await database.exec(
				'INSERT INTO binding_proof (value) VALUES (?)',
				['authorised-profile-binding'],
			);
			await expect(database.selectOne(
				'SELECT value FROM binding_proof',
			)).resolves.toEqual({ value: 'authorised-profile-binding' });
		} finally {
			await database.close();
		}
	});

	test('a supplied binding prevents construction of the stock profile database', () => {
		const binding = {
			driver: new DatabaseDriverNode(),
			name: 'watchtower-profile',
		};
		const createStockBinding = jest.fn(() => {
			throw new Error('stock profile database must remain unavailable');
		});

		expect(selectProfileDatabaseBinding(binding, createStockBinding)).toBe(binding);
		expect(createStockBinding).not.toHaveBeenCalled();
	});
});
