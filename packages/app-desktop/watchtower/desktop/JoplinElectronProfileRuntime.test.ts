import JoplinElectronProfileRuntime from './JoplinElectronProfileRuntime';
import type { JoplinEncryptedProfile } from '../profile/joplinProfileTypes';
import type { ProfileStorageBinding } from '@joplin/lib/profileStorageBinding';
import type { Session } from 'electron';

describe('JoplinElectronProfileRuntime', () => {
	test('runs Joplin with the encrypted binding and memory-only session until hard stop', async () => {
		const electronSession = {} as Session;
		const profile = {
			ephemeralRuntime: {
				electronSession: () => electronSession,
			},
			runtimeFileSystem: { temporaryDirectory: () => 'watchtower-memory://temporary' },
		} as unknown as JoplinEncryptedProfile;
		let receivedBinding: ProfileStorageBinding|undefined;
		let receivedSession: Session|undefined;
		let closed = false;
		const runtime = new JoplinElectronProfileRuntime(async (binding, session) => {
			receivedBinding = binding;
			receivedSession = session;
			return {
				closeProfileSession: async () => {
					closed = true;
				},
				terminateProfileSession: () => true,
			};
		});

		await runtime.start(profile, new AbortController().signal);

		expect(receivedBinding?.runtimeFileSystem).toBe(profile.runtimeFileSystem);
		expect(receivedSession).toBe(electronSession);
		await expect(runtime.stop('close', new AbortController().signal)).resolves.toEqual({
			kind: 'stopped',
		});
		expect(closed).toBe(true);
		expect(runtime.terminate()).toBe(true);
	});
});
