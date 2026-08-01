import type { ProfileStorageBinding } from '@joplin/lib/profileStorageBinding';
import publicJoplinRuntimeDirectory from './publicJoplinRuntimeDirectory';

describe('publicJoplinRuntimeDirectory', () => {
	test('keeps Joplin public runtime state beside the Watchtower vault lock', () => {
		expect(publicJoplinRuntimeDirectory({
			publicVaultLockFilePath: 'C:\\Watchtower One\\runtime\\vault.lock',
		} as ProfileStorageBinding)).toBe('C:\\Watchtower One\\runtime');
	});
});
