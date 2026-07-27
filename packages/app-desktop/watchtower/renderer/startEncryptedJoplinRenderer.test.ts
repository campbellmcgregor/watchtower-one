import {
	startEncryptedJoplinRenderer,
} from './startEncryptedJoplinRenderer';
import { ProfileStorageBinding } from '@joplin/lib/profileStorageBinding';
import { Bridge } from '../../bridge';
import ElectronAppWrapper from '../../ElectronAppWrapper';

jest.mock('@sentry/electron/main', () => ({
	IPCMode: { Classic: 'classic' },
	captureException: jest.fn(),
	electronMinidumpIntegration: jest.fn(),
	init: jest.fn(),
}));

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
		const profileStorage = {} as ProfileStorageBinding;
		const trustedBridge = new Bridge(
			{} as ElectronAppWrapper,
			'net.watchtower.one',
			'Watchtower One',
			'C:\\WatchtowerPublicBootstrap',
			false,
			'',
			profileStorage,
		);
		let receivedStart: {
			argv: string[];
			profileStorage: ProfileStorageBinding|undefined;
		}|undefined;

		await expect(startEncryptedJoplinRenderer(
			trustedBridge,
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
			argv: process.argv,
			profileStorage,
		});
	});
});
