import { createHash } from 'crypto';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import EncryptedProfileStorage from '../profile/EncryptedProfileStorage';
import {
	EncryptedProfileConnection,
	encryptedProfileDatabaseName,
} from '../profile/profileStorageTypes';
import VaultCredentialLifecycle from '../vault/VaultCredentialLifecycle';
import VaultKeyEnvelopeStore from '../vault/vaultKeyEnvelopeStore';
import {
	makeEncryptedDesktopDependencies,
} from './makeEncryptedDesktopDependencies';
import { startWatchtowerDesktop } from './startWatchtowerDesktop';

// cspell:ignore SIGNALAPP sqlcipher

const makeConnection = (): EncryptedProfileConnection => ({
	selectOne: async () => undefined,
	selectAll: async () => [],
	exec: async () => undefined,
	close: async () => {},
	terminate: () => true,
});

describe('makeEncryptedDesktopDependencies', () => {
	let vaultDirectory = '';

	beforeEach(async () => {
		vaultDirectory = await mkdtemp(join(tmpdir(), 'watchtower-production-bootstrap-'));
	});

	afterEach(async () => {
		await rm(vaultDirectory, { recursive: true, force: true });
	});

	test('unlocks encrypted storage before loading Joplin and rejects plaintext fallback', async () => {
		const passphrase = 'production private atlas words';
		const credentialLifecycle = new VaultCredentialLifecycle(
			new VaultKeyEnvelopeStore(vaultDirectory),
		);
		const begun = await credentialLifecycle.beginCreate({
			passphrase,
			memoryProfile: 'qualified-constrained',
		});
		if (begun.kind !== 'recoveryConfirmationRequired') {
			throw new Error('Expected vault creation to begin');
		}
		const created = await credentialLifecycle.confirmCreate({
			creationId: begun.creationId,
			recoverySecret: begun.recoverySecret,
		});
		if (created.kind !== 'opened') throw new Error('Expected vault creation');
		const expectedFingerprint = await created.keyRing.withDerivedKey(
			'sqlcipher',
			key => createHash('sha256').update(key).digest('hex'),
		);
		created.keyRing.dispose();

		const events: string[] = [];
		const makeDependencies = (candidatePassphrase: string) =>
			makeEncryptedDesktopDependencies({
				command: { kind: 'unlock', passphrase: candidatePassphrase },
				databasePath: join(vaultDirectory, 'profile.sqlite'),
				envelopeDirectory: vaultDirectory,
				openProfileStorage: async keyRing => {
					events.push(await keyRing.withDerivedKey(
						'sqlcipher',
						key => `storage:${createHash('sha256').update(key).digest('hex')}`,
					));
					return new EncryptedProfileStorage(makeConnection());
				},
				profileHostOptions: {
					ephemeralSessionFactory: {
						fromPartition: async () => ({
							storagePath: null,
							clearCache: async () => {},
							clearStorageData: async () => {},
							closeAllConnections: async () => {},
						}),
					},
					resourceDirectory: 'C:\\WatchtowerVirtualProfile\\resources',
				},
				loadJoplinProfileRuntime: async () => {
					events.push('joplin-loaded');
					return {
						start: async () => {
							events.push('joplin-started');
						},
						stop: async () => ({ kind: 'stopped' }),
						terminate: () => true,
					};
				},
			});

		const unlocked = await startWatchtowerDesktop(makeDependencies(passphrase));
		expect(unlocked.result).toEqual({ kind: 'unlocked' });
		expect(events).toEqual([
			`storage:${expectedFingerprint}`,
			'joplin-loaded',
			'joplin-started',
		]);
		await unlocked.lifecycle.end('close');

		events.length = 0;
		const rejected = await startWatchtowerDesktop(
			makeDependencies('incorrect private atlas words'),
		);
		expect(rejected.result).toEqual({
			kind: 'rejected',
			reason: 'wrongCredential',
		});
		expect(events).toEqual([]);
	});

	const sqlCipherTest = process.env.WATCHTOWER_SQLCIPHER_PREBUILD_ROOT ?
		test :
		test.skip;
	sqlCipherTest('opens the production SQLCipher profile through desktop bootstrap', async () => {
		process.env['@SIGNALAPP/SQLCIPHER_PREBUILD'] =
			process.env.WATCHTOWER_SQLCIPHER_PREBUILD_ROOT;
		const passphrase = 'production sqlcipher atlas words';
		const credentialLifecycle = new VaultCredentialLifecycle(
			new VaultKeyEnvelopeStore(vaultDirectory),
		);
		const begun = await credentialLifecycle.beginCreate({
			passphrase,
			memoryProfile: 'qualified-constrained',
		});
		if (begun.kind !== 'recoveryConfirmationRequired') {
			throw new Error('Expected vault creation to begin');
		}
		const created = await credentialLifecycle.confirmCreate({
			creationId: begun.creationId,
			recoverySecret: begun.recoverySecret,
		});
		if (created.kind !== 'opened') throw new Error('Expected vault creation');
		created.keyRing.dispose();

		const started = await startWatchtowerDesktop(
			makeEncryptedDesktopDependencies({
				command: { kind: 'unlock', passphrase },
				databasePath: join(vaultDirectory, 'profile.sqlite'),
				envelopeDirectory: vaultDirectory,
				profileHostOptions: {
					ephemeralSessionFactory: {
						fromPartition: async () => ({
							storagePath: null,
							clearCache: async () => {},
							clearStorageData: async () => {},
							closeAllConnections: async () => {},
						}),
					},
					resourceDirectory: 'C:\\WatchtowerVirtualProfile\\resources',
				},
				loadJoplinProfileRuntime: async () => ({
					start: async profile => {
						await profile.database.open({
							name: encryptedProfileDatabaseName,
						});
						await profile.database.exec(
							'CREATE TABLE bootstrap_proof (content TEXT NOT NULL)',
						);
						await profile.database.exec(
							'INSERT INTO bootstrap_proof (content) VALUES (?)',
							['encrypted-bootstrap-canary'],
						);
						await expect(profile.database.selectOne(
							'SELECT content FROM bootstrap_proof',
						)).resolves.toEqual({
							content: 'encrypted-bootstrap-canary',
						});
					},
					stop: async () => ({ kind: 'stopped' }),
					terminate: () => true,
				}),
			}),
		);

		expect(started.result).toEqual({ kind: 'unlocked' });
		await expect(started.lifecycle.end('close')).resolves.toEqual({
			kind: 'locked',
		});
	});
});
