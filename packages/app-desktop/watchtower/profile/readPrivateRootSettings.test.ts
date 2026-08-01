import {
	ProfilePrivateData,
} from '@joplin/lib/profileStorageBinding';
import readPrivateRootSettings from './readPrivateRootSettings';

describe('readPrivateRootSettings', () => {
	test('reads startup preferences from encrypted private profile data', async () => {
		const privateData: ProfilePrivateData = {
			read: async () => Buffer.from(JSON.stringify({
				autoUploadCrashDumps: true,
			})),
			write: async () => {},
			list: async () => [],
			remove: async () => {},
		};

		await expect(readPrivateRootSettings(privateData)).resolves.toEqual({
			autoUploadCrashDumps: true,
		});
	});

	test('fails closed instead of creating a plaintext backup for malformed settings', async () => {
		const write = jest.fn(async () => {});
		const remove = jest.fn(async () => {});
		const privateData: ProfilePrivateData = {
			read: async () => Buffer.from('{ malformed'),
			write,
			list: async () => [],
			remove,
		};

		await expect(readPrivateRootSettings(privateData)).rejects.toThrow(
			'Could not parse encrypted settings (root)',
		);
		expect(write).not.toHaveBeenCalled();
		expect(remove).not.toHaveBeenCalled();
	});
});
