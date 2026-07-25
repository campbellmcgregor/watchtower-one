import SqlCipherEncryptedProfileConnection, {
	SqlCipherNativeDatabase,
	SqlCipherProfileConfigurationError,
} from './SqlCipherEncryptedProfileConnection';
// cspell:ignore sqlcipher

const requiredCompileOptions = [
	'DQS=3',
	'ENABLE_FTS3',
	'ENABLE_FTS4',
	'ENABLE_FTS5',
	'TEMP_STORE=2',
];

const makeNativeDatabase = (
	compileOptions = requiredCompileOptions,
): SqlCipherNativeDatabase => {
	const values = new Map<string, unknown>([
		['cipher_version', '4.10.0 community'],
		['cipher_plaintext_header_size', 0],
		['cipher_memory_security', 1],
		['temp_store', 2],
		['secure_delete', 1],
		['foreign_keys', 1],
		['journal_mode', 'wal'],
		['integrity_check', 'ok'],
	]);
	return {
		pragma: (source, options) => {
			if (source.toLowerCase() === 'cipher_integrity_check') return [];
			const assignment = source.match(/^([a-z_]+)\s*=\s*(.+)$/i);
			if (assignment) {
				const name = assignment[1].toLowerCase();
				const rawValue = assignment[2].toLowerCase();
				const value = rawValue === 'on' ? 1 :
					rawValue === 'memory' ? 2 :
						rawValue === 'wal' ? 'wal' :
							Number(rawValue);
				values.set(name, value);
				return options?.simple ? value : [];
			}
			const value = values.get(source.toLowerCase());
			return options?.simple ? value : [{ value }];
		},
		prepare: sql => ({
			run: async () => undefined,
			get: async () => sql === 'SELECT body FROM notes WHERE id = ?' ?
				{ body: 'sqlcipher-profile-canary' } : undefined,
			all: async () => sql === 'PRAGMA compile_options' ?
				compileOptions.map(compileOption => ({ compile_options: compileOption })) : [],
		}),
		close: () => undefined,
	};
};

describe('SqlCipherEncryptedProfileConnection', () => {

	test('a verified SQLCipher connection supports ordinary profile queries', async () => {
		const connection = await SqlCipherEncryptedProfileConnection.verify(makeNativeDatabase());

		await connection.exec(
			'INSERT INTO notes (id, body) VALUES (?, ?)',
			['watchtower-note', 'sqlcipher-profile-canary'],
		);
		await expect(connection.selectOne(
			'SELECT body FROM notes WHERE id = ?',
			['watchtower-note'],
		)).resolves.toEqual({ body: 'sqlcipher-profile-canary' });
	});

	test('an incompatible SQLCipher build fails closed before profile queries', async () => {
		const nativeDatabase = makeNativeDatabase([
			'DQS=0',
			'ENABLE_FTS5',
			'TEMP_STORE=1',
		]);

		await expect(SqlCipherEncryptedProfileConnection.verify(nativeDatabase)).rejects.toEqual(
			expect.objectContaining<Partial<SqlCipherProfileConfigurationError>>({
				code: 'incompatibleSqlCipherBuild',
			}),
		);
	});

	test.each([
		'ATTACH DATABASE ? AS plaintext_copy',
		'SELECT load_extension(?)',
		'PRAGMA temp_store = FILE',
		'PRAGMA cipher_plaintext_header_size = 32',
		'PRAGMA cipher_memory_security = OFF',
		'PRAGMA journal_mode = DELETE',
		'PRAGMA temp_store = MEMORY; PRAGMA temp_store = FILE',
		'PRAGMA temp_store(FILE)',
		'PRAGMA main.journal_mode = DELETE',
		'VACUUM INTO ?',
	])('a profile query cannot relax encrypted persistence: %s', async unsafeSql => {
		const connection = await SqlCipherEncryptedProfileConnection.verify(makeNativeDatabase());

		await expect(connection.exec(unsafeSql, ['outside.sqlite'])).rejects.toEqual(
			expect.objectContaining({ code: 'unsafeProfileQuery' }),
		);
	});

});
