import { VaultSessionKeyRing } from '../vault/vaultKeyEnvelope';
import EncryptedProfileStorage from './EncryptedProfileStorage';
import SqlCipherEncryptedProfileConnection from './SqlCipherEncryptedProfileConnection';
import { SqlCipherNativeDatabase } from './sqlCipherProfileTypes';

// cspell:ignore signalapp sqlcipher

const openNativeDatabase = (
	databasePath: string,
	key: Buffer,
): SqlCipherNativeDatabase => {
	// eslint-disable-next-line @typescript-eslint/no-var-requires -- Native binding must load only after vault unlock.
	const sqlCipherBinding = require('@signalapp/sqlcipher');
	sqlCipherBinding.setLogger(() => {});
	const SqlCipherDatabase = sqlCipherBinding.default;
	const database = new SqlCipherDatabase(databasePath);
	database.pragma(`key = "x'${key.toString('hex')}'"`);
	return database;
};

const openSqlCipherProfileStorage = async (
	databasePath: string,
	keyRing: VaultSessionKeyRing,
): Promise<EncryptedProfileStorage> => {
	return await keyRing.withDerivedKey('sqlcipher', async key => {
		const connection = await SqlCipherEncryptedProfileConnection.verify(
			openNativeDatabase(databasePath, key),
		);
		return new EncryptedProfileStorage(connection);
	});
};

export default openSqlCipherProfileStorage;
