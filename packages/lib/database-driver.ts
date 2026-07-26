
interface DatabaseOptions {
	name: string;
}
export type DatabaseOpenOptions = DatabaseOptions;
export type DatabaseCloseOptions = DatabaseOptions;

export type SqlSelectParams = unknown[]|Record<string, unknown>|null;

export type SelectResult = Record<string, unknown>|undefined;

interface DatabaseDriver {
	open(options: DatabaseOpenOptions): Promise<void>;
	close?(): Promise<void>;
	deleteDatabase?(options: DatabaseCloseOptions): Promise<void>;

	selectOne(sql: string, params: SqlSelectParams): Promise<SelectResult>;
	selectAll(sql: string, params: SqlSelectParams): Promise<Record<string, unknown>[]>;

	// May or may not return the output of the command
	// TODO: Make this consistent
	exec(sql: string, params: SqlSelectParams): Promise<unknown>;
	sqliteErrorToJsError(error: unknown, sql?: string, params?: SqlSelectParams): Error;
}

export default DatabaseDriver;
