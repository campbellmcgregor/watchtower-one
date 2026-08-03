import Setting from '../../models/Setting';
import ResourceEditWatcher from './index';

describe('ResourceEditWatcher encrypted-profile policy', () => {
	test('rejects external copies at the service boundary', async () => {
		Setting.setConstant('allowExternalEditing', false);
		try {
			const watcher = new ResourceEditWatcher();

			await expect(watcher.openAndWatch('resource-id')).rejects.toThrow(
				'External editing is unavailable for encrypted profiles',
			);
			await expect(watcher.openAsReadOnly('resource-id')).rejects.toThrow(
				'External editing is unavailable for encrypted profiles',
			);
			await expect(watcher.externalApi().watch({ resourceId: 'resource-id' })).rejects.toThrow(
				'External editing is unavailable for encrypted profiles',
			);
		} finally {
			Setting.setConstant('allowExternalEditing', true);
		}
	});
});
