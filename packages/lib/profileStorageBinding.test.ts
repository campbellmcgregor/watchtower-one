import FsDriverNode from './fs-driver-node';
import Resource from './models/Resource';
import Setting from './models/Setting';
import resolveProfileStorageBinding, {
	makePrivateProfileConfigStorage,
	ProfileResourceFileSystem,
} from './profileStorageBinding';
import EncryptionService from './services/e2ee/EncryptionService';

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
			{ database, resourceFileSystem, privateData, profileConfig },
			createStockStorage,
		);

		expect(createStockStorage).not.toHaveBeenCalled();
		expect(resolved.database).toBe(database);
		expect(resolved.resourceFileSystem).toBe(resourceFileSystem);
		expect(resolved.resourceDirectory).toBe(resourceFileSystem.resourceDirectory());
		expect(Setting.value('resourceDir')).toBe(resourceFileSystem.resourceDirectory());
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
});
