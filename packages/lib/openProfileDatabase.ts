import JoplinDatabase from './JoplinDatabase';

type ProfileSqlParameters = unknown[]|Record<string, unknown>|null;

export interface ProfileDatabaseDriver {
	open(options: { name: string }): Promise<void>;
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

export const selectProfileDatabaseBinding = (
	suppliedBinding: ProfileDatabaseBinding|undefined,
	createDefaultBinding: ()=> ProfileDatabaseBinding,
): ProfileDatabaseBinding => suppliedBinding ?? createDefaultBinding();

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
