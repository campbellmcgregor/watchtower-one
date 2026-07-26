import FsDriverNode from './fs-driver-node';
import Resource from './models/Resource';
import Setting from './models/Setting';
import resolveProfileStorageBinding, {
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
	test('installs supplied database and resource storage after profile paths are known', () => {
		const database = {
			driver: new DatabaseDriverNode(),
			name: 'watchtower-encrypted-profile',
		};
		const resourceFileSystem = new TestResourceFileSystem();
		const createStockStorage = jest.fn(() => {
			throw new Error('stock profile storage must remain unavailable');
		});

		const resolved = resolveProfileStorageBinding(
			{ database, resourceFileSystem },
			createStockStorage,
		);

		expect(createStockStorage).not.toHaveBeenCalled();
		expect(resolved.database).toBe(database);
		expect(resolved.resourceFileSystem).toBe(resourceFileSystem);
		expect(resolved.resourceDirectory).toBe(resourceFileSystem.resourceDirectory());
		expect(Setting.value('resourceDir')).toBe(resourceFileSystem.resourceDirectory());
		expect(Resource.fsDriver()).toBe(resourceFileSystem);
		expect(EncryptionService.fsDriver_).toBe(resourceFileSystem);
	});
});
