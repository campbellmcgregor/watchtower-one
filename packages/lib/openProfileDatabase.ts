import JoplinDatabase from './JoplinDatabase';
import DatabaseDriver from './database-driver';

export interface ProfileDatabaseBinding {
	driver: DatabaseDriver;
	name: string;
}

interface OpenProfileDatabaseOptions {
	binding: ProfileDatabaseBinding;
	logger: Parameters<JoplinDatabase['setLogger']>[0];
}

const openProfileDatabase = async ({
	binding,
	logger,
}: OpenProfileDatabaseOptions): Promise<JoplinDatabase> => {
	const database = new JoplinDatabase(binding.driver);
	database.setLogExcludedQueryTypes(['SELECT']);
	database.setLogger(logger);
	await database.open({ name: binding.name });
	return database;
};

export default openProfileDatabase;
