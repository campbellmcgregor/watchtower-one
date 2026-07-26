import JoplinDatabase from './JoplinDatabase';

type ProfileSqlParameters = unknown[]|Record<string, unknown>|null;

interface ProfileDatabaseOpenOptions {
	name: string;
}

export interface ProfileDatabaseDriver {
	open(options: ProfileDatabaseOpenOptions): Promise<void>;
	close(): Promise<void>;
	selectOne(sql: string, params?: ProfileSqlParameters): Promise<unknown>;
	selectAll(sql: string, params?: ProfileSqlParameters): Promise<unknown[]>;
	exec(sql: string, params?: ProfileSqlParameters): Promise<unknown>;
	sqliteErrorToJsError(
		error: unknown,
		sql?: string,
		params?: ProfileSqlParameters,
	): Error;
}

export interface ProfileDatabaseBinding {
	driver: ProfileDatabaseDriver;
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
