import FsDriverBase from './fs-driver-base';
import Resource from './models/Resource';
import Setting from './models/Setting';
import { ProfileDatabaseBinding } from './openProfileDatabase';
import EncryptionService from './services/e2ee/EncryptionService';

export interface ProfileResourceFileSystem extends FsDriverBase {
	resourceDirectory(): string;
}

export interface ProfileStorageBinding {
	database: ProfileDatabaseBinding;
	resourceFileSystem: ProfileResourceFileSystem;
}

interface StockProfileStorage {
	database: ProfileDatabaseBinding;
	resourceDirectory: string;
}

export interface ResolvedProfileStorage extends StockProfileStorage {
	resourceFileSystem?: ProfileResourceFileSystem;
}

const resolveProfileStorageBinding = (
	binding: ProfileStorageBinding|undefined,
	createStock: ()=> StockProfileStorage,
): ResolvedProfileStorage => {
	const stock = binding ? undefined : createStock();
	const resourceFileSystem = binding?.resourceFileSystem;
	const resourceDirectory = resourceFileSystem?.resourceDirectory() ?? stock!.resourceDirectory;

	Setting.setConstant('resourceDirName', 'resources');
	Setting.setConstant('resourceDir', resourceDirectory);
	if (resourceFileSystem) {
		Resource.fsDriver_ = resourceFileSystem;
		EncryptionService.fsDriver_ = resourceFileSystem;
	}

	return {
		database: binding?.database ?? stock!.database,
		resourceDirectory,
		resourceFileSystem,
	};
};

export default resolveProfileStorageBinding;
