import PreProfileVaultBootstrap, {
	VaultOpenHandle,
	VaultSessionCapability,
} from '../vault/PreProfileVaultBootstrap';
import EphemeralProfileRuntime, {
	EphemeralElectronSession,
	EphemeralElectronSessionFactory,
} from './EphemeralProfileRuntime';

const unlock = async (
	sessionFactory: EphemeralElectronSessionFactory,
) => {
	let capability: VaultSessionCapability|undefined;
	const handle: VaultOpenHandle = {
		close: async () => undefined,
		terminate: () => true,
	};
	const lifecycle = new PreProfileVaultBootstrap({
		create: async () => ({ kind: 'opened', handle }),
		unlock: async () => ({ kind: 'opened', handle }),
		recover: async () => ({ kind: 'opened', handle }),
		abort: () => true,
	});
	await lifecycle.start('unlock', {
		start: async sessionCapability => {
			capability = sessionCapability;
		},
		stop: async () => ({ kind: 'stopped' }),
		terminate: () => true,
	});
	const runtime = new EphemeralProfileRuntime(sessionFactory);
	await runtime.start(capability!);
	return { lifecycle, runtime };
};

describe('EphemeralProfileRuntime', () => {

	test('content-bearing Electron state uses a fresh memory-only, cache-disabled session', async () => {
		const events: string[] = [];
		const electronSession: EphemeralElectronSession = {
			storagePath: null,
			clearCache: async () => {
				events.push('cache-cleared');
			},
			clearStorageData: async () => {
				events.push('storage-cleared');
			},
			closeAllConnections: async () => {
				events.push('connections-closed');
			},
		};
		let partition = '';
		const { lifecycle, runtime } = await unlock({
			fromPartition: async (requestedPartition, options) => {
				partition = requestedPartition;
				expect(options).toEqual({ cache: false });
				return electronSession;
			},
		});

		expect(partition).toMatch(/^watchtower-session-/);
		expect(partition).not.toContain('persist:');
		expect(runtime.session()).toBe(electronSession);

		await runtime.dispose();
		expect(events).toEqual([
			'connections-closed',
			'storage-cleared',
			'cache-cleared',
		]);
		await expect(lifecycle.end('close')).resolves.toEqual({ kind: 'locked' });
	});

	test('a file-backed Electron session is rejected before Joplin can use it', async () => {
		const electronSession: EphemeralElectronSession = {
			storagePath: 'C:\\plaintext-electron-state',
			clearCache: async () => undefined,
			clearStorageData: async () => undefined,
			closeAllConnections: async () => undefined,
		};
		let capability: VaultSessionCapability|undefined;
		const handle: VaultOpenHandle = {
			close: async () => undefined,
			terminate: () => true,
		};
		const lifecycle = new PreProfileVaultBootstrap({
			create: async () => ({ kind: 'opened', handle }),
			unlock: async () => ({ kind: 'opened', handle }),
			recover: async () => ({ kind: 'opened', handle }),
			abort: () => true,
		});
		await lifecycle.start('unlock', {
			start: async sessionCapability => {
				capability = sessionCapability;
			},
			stop: async () => ({ kind: 'stopped' }),
			terminate: () => true,
		});
		const runtime = new EphemeralProfileRuntime({
			fromPartition: async () => electronSession,
		});

		await expect(runtime.start(capability!)).rejects.toThrow(
			'Electron session is not memory-only',
		);
		expect(() => runtime.session()).toThrow('Ephemeral profile runtime is not active');
		await expect(lifecycle.end('close')).resolves.toEqual({ kind: 'locked' });
	});

});
