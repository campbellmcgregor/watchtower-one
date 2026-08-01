import FsDriverNode from './fs-driver-node';
import Resource from './models/Resource';
import Setting from './models/Setting';
import resolveProfileStorageBinding, {
	makeEphemeralProfileLogFileSystem,
	makePrivateProfileConfigStorage,
	ProfileLogFileSystemBinding,
	ProfileResourceFileSystem,
} from './profileStorageBinding';
import EncryptionService from './services/e2ee/EncryptionService';
import Logger, { TargetType } from '@joplin/utils/Logger';

const { DatabaseDriverNode } = require('./database-driver-node.js');

class TestResourceFileSystem extends FsDriverNode implements ProfileResourceFileSystem {

	public resourceDirectory() {
		return 'C:\\WatchtowerVirtualProfile\\resources';
	}
}

describe('resolveProfileStorageBinding', () => {
	afterEach(() => {
		Setting.setFileHandlerFactories();
	});

	test('installs supplied database, resource, and private settings storage after profile paths are known', async () => {
		const database = {
			driver: new DatabaseDriverNode(),
			name: 'watchtower-encrypted-profile',
		};
		const resourceFileSystem = new TestResourceFileSystem();
		const privateContent = new Map<string, Buffer>();
		const privateData = {
			write: async (_scope: 'settings', key: string, content: Uint8Array) => {
				privateContent.set(key, Buffer.from(content));
			},
			read: async (_scope: 'settings', key: string) => privateContent.get(key),
			list: async () => [...privateContent.keys()].sort(),
			remove: async (_scope: 'settings', key: string) => {
				privateContent.delete(key);
			},
		};
		const createStockStorage = jest.fn(() => {
			throw new Error('stock profile storage must remain unavailable');
		});
		const profileConfig = makePrivateProfileConfigStorage(privateData);
		Setting.setConstant('isSubProfile', false);

		const resolved = resolveProfileStorageBinding(
			{
				database,
				pluginCode: {
					packageDirectory: 'C:\\WatchtowerPublicCode\\plugins\\packages',
					cacheDirectory: 'C:\\WatchtowerPublicCode\\plugins\\cache',
				},
				logFileSystem: {
					appendFile: async () => {},
				},
				resourceFileSystem,
				privateData,
				profileConfig,
				publicVaultLockFilePath: 'C:\\WatchtowerPublicRuntime\\vault.lock',
			},
			createStockStorage,
		);

		expect(createStockStorage).not.toHaveBeenCalled();
		expect(resolved.database).toBe(database);
		expect(resolved.resourceFileSystem).toBe(resourceFileSystem);
		expect(resolved.resourceDirectory).toBe(resourceFileSystem.resourceDirectory());
		expect(Setting.value('resourceDir')).toBe(resourceFileSystem.resourceDirectory());
		expect(Setting.value('pluginDir')).toBe('C:\\WatchtowerPublicCode\\plugins\\packages');
		expect(Setting.value('pluginCacheDir')).toBe('C:\\WatchtowerPublicCode\\plugins\\cache');
		expect(Setting.value('allowArbitraryPluginInstallation')).toBe(false);
		expect(Resource.fsDriver()).toBe(resourceFileSystem);
		expect(EncryptionService.fsDriver_).toBe(resourceFileSystem);

		await Setting.rootFileHandler.save({ locale: 'en_GB' });
		await Setting.fileHandler.save({ 'sync.target': 5 });
		await Setting.reset();

		await expect(Setting.rootFileHandler.load()).resolves.toEqual({
			locale: 'en_GB',
		});
		await expect(Setting.fileHandler.load()).resolves.toEqual({
			'sync.target': 5,
		});
		expect([...privateContent.keys()].sort()).toEqual([
			'profile:default',
			'root',
		]);
	});

	test('adapts encrypted private data to profile configuration storage', async () => {
		const privateContent = new Map<string, Buffer>();
		const privateData = {
			write: async (_scope: 'settings', key: string, content: Uint8Array) => {
				privateContent.set(key, Buffer.from(content));
			},
			read: async (_scope: 'settings', key: string) => privateContent.get(key),
			list: async () => [...privateContent.keys()].sort(),
			remove: async (_scope: 'settings', key: string) => {
				privateContent.delete(key);
			},
		};
		const storage = makePrivateProfileConfigStorage(privateData);

		await storage.write('{"currentProfileId":"default"}');

		expect(storage.description).toBe('encrypted profile configuration');
		expect(privateContent.get('profiles')?.toString('utf8')).toBe('{"currentProfileId":"default"}');
		await expect(storage.read()).resolves.toBe('{"currentProfileId":"default"}');
	});

	test('routes Joplin file log targets through session-scoped ephemeral storage', async () => {
		const artifacts = new Map<string, Buffer>();
		const logFileSystem = makeEphemeralProfileLogFileSystem({
			write: async (category, key, content) => {
				expect(category).toBe('log');
				artifacts.set(key, Buffer.from(content));
			},
			read: async (category, key) => {
				expect(category).toBe('log');
				return artifacts.get(key);
			},
		});
		const previousFsDriver = Logger.fsDriver_;
		Logger.fsDriver_ = logFileSystem;
		try {
			const logger = new Logger();
			logger.addTarget(TargetType.File, {
				path: 'C:\\public-profile\\log-main-process.txt',
			});

			logger.info('Private laboratory notebook opened');
			logger.warn('Private laboratory notebook changed');
			await logger.waitForFileWritesToComplete_();

			expect([...artifacts.keys()]).toEqual(['log-main-process.txt']);
			const content = artifacts.get('log-main-process.txt')?.toString('utf8');
			expect(content).toContain('Private laboratory notebook opened');
			expect(content).toContain('Private laboratory notebook changed');
		} finally {
			Logger.fsDriver_ = previousFsDriver;
		}
	});

	test('bounds each ephemeral Joplin log while retaining its newest entries', async () => {
		const artifacts = new Map<string, Buffer>();
		const logFileSystem = makeEphemeralProfileLogFileSystem({
			write: async (_category, key, content) => {
				artifacts.set(key, Buffer.from(content));
			},
			read: async (_category, key) => artifacts.get(key),
		});

		await logFileSystem.appendFile(
			'C:\\public-profile\\log.txt',
			'a'.repeat(4 * 1024 * 1024),
			'utf8',
		);
		await logFileSystem.appendFile(
			'C:\\public-profile\\log.txt',
			'b'.repeat(4 * 1024 * 1024),
			'utf8',
		);

		const content = artifacts.get('log.txt')!;
		expect(content.byteLength).toBe(5 * 1024 * 1024);
		expect(content.subarray(0, 4).toString('utf8')).toBe('aaaa');
		expect(content.subarray(-4).toString('utf8')).toBe('bbbb');
	});

	test('keeps bounded ephemeral logs valid UTF-8 at their retained boundary', async () => {
		const artifacts = new Map<string, Buffer>();
		const logFileSystem = makeEphemeralProfileLogFileSystem({
			write: async (_category, key, content) => {
				artifacts.set(key, Buffer.from(content));
			},
			read: async (_category, key) => artifacts.get(key),
		});

		await logFileSystem.appendFile(
			'C:\\public-profile\\log.txt',
			`${'x'.repeat(6 * 1024 * 1024)}😀${'z'.repeat(5 * 1024 * 1024 - 1)}`,
			'utf8',
		);

		const content = artifacts.get('log.txt')!;
		expect(content.byteLength).toBe(5 * 1024 * 1024 - 1);
		expect(content.toString('utf8')).not.toContain('�');
		expect(content.subarray(0, 4).toString('utf8')).toBe('zzzz');
	});

	test('restores the process logger after draining an ephemeral log session', async () => {
		const artifacts = new Map<string, Buffer>();
		const previousFsDriver = {
			appendFile: async () => {},
		};
		Logger.fsDriver_ = previousFsDriver;
		const binding = new ProfileLogFileSystemBinding();
		binding.install(makeEphemeralProfileLogFileSystem({
			write: async (_category, key, content) => {
				artifacts.set(key, Buffer.from(content));
			},
			read: async (_category, key) => artifacts.get(key),
		}));
		const logger = new Logger();
		logger.addTarget(TargetType.File, { path: 'C:\\public-profile\\log.txt' });

		logger.info('last encrypted session entry');
		await binding.dispose();

		expect(artifacts.get('log.txt')?.toString('utf8')).toContain(
			'last encrypted session entry',
		);
		expect(Logger.fsDriver_).toBe(previousFsDriver);
	});
});
