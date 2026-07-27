import {
	startEncryptedJoplinRenderer,
} from './startEncryptedJoplinRenderer';
import { ProfileStorageBinding } from '@joplin/lib/profileStorageBinding';

describe('startEncryptedJoplinRenderer', () => {
	test('does not initialize Joplin when encrypted profile storage is unavailable', async () => {
		let applicationStarted = false;

		await expect(startEncryptedJoplinRenderer(
			{
				processArgv: () => ['watchtower-one'],
				profileStorage: () => undefined,
			},
			{
				start: async () => {
					applicationStarted = true;
				},
			},
		)).rejects.toThrow('Encrypted profile storage is unavailable');

		expect(applicationStarted).toBe(false);
	});

	test('starts Joplin with the encrypted profile binding from the trusted bridge', async () => {
		const argv = ['watchtower-one', '--no-welcome'];
		const profileStorage = {} as ProfileStorageBinding;
		let receivedStart: {
			argv: string[];
			profileStorage: ProfileStorageBinding|undefined;
		}|undefined;

		await expect(startEncryptedJoplinRenderer(
			{
				processArgv: () => argv,
				profileStorage: () => profileStorage,
			},
			{
				start: async (receivedArgv, options) => {
					receivedStart = {
						argv: receivedArgv,
						profileStorage: options.profileStorage,
					};
					return 'renderer-started';
				},
			},
		)).resolves.toBe('renderer-started');

		expect(receivedStart).toEqual({
			argv,
			profileStorage,
		});
	});
});
