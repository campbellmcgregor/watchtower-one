import {
	profileApplicationArgv,
	startEncryptedJoplinRenderer,
} from './startEncryptedJoplinRenderer';
import { ProfileStorageBinding } from '@joplin/lib/profileStorageBinding';
import { Bridge } from '../../bridge';
import ElectronAppWrapper from '../../ElectronAppWrapper';
import * as Sentry from '@sentry/electron/main';

jest.mock('@sentry/electron/main', () => ({
	IPCMode: { Classic: 'classic' },
	captureException: jest.fn(),
	electronMinidumpIntegration: jest.fn(),
	init: jest.fn(),
}));
jest.mock('electron', () => ({
	BrowserWindow: class {},
	Menu: {},
	app: {},
	dialog: {},
	globalShortcut: {},
	nativeImage: {},
	nativeTheme: {},
	safeStorage: {},
	shell: {},
}));

describe('startEncryptedJoplinRenderer', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('removes harness-only arguments before Joplin parses a test launch', () => {
		expect(profileApplicationArgv([
			'Watchtower One.exe',
			'--inspect=0',
			'--running-tests',
			'--watchtower-data-root',
			'C:\\isolated-proof',
		])).toEqual([
			'Watchtower One.exe',
			'--running-tests',
		]);
	});

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
			true,
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
		expect(Sentry.init).not.toHaveBeenCalled();
		expect(trustedBridge.autoUploadCrashDumps).toBe(false);
	});
});
