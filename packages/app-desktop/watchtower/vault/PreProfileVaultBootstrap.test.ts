import PreProfileVaultBootstrap, {
	ProfileRuntime,
	VaultAccessAdapter,
	VaultOpenHandle,
	VaultSessionCapability,
} from './PreProfileVaultBootstrap';

describe('PreProfileVaultBootstrap', () => {
	test('starts the profile only after the vault is open', async () => {
		const events: string[] = [];
		const openHandle: VaultOpenHandle = {
			close: async () => {
				events.push('vault:close');
			},
		};
		const accessAdapter: VaultAccessAdapter = {
			create: async () => {
				events.push('vault:open');
				return { kind: 'opened', handle: openHandle };
			},
			unlock: jest.fn(),
			recover: jest.fn(),
		};
		const profileRuntime: ProfileRuntime = {
			stop: async () => ({ kind: 'stopped' }),
		};
		const bootstrap = new PreProfileVaultBootstrap(accessAdapter);
		let issuedCapability: VaultSessionCapability|null = null;

		const result = await bootstrap.start('create', async capability => {
			issuedCapability = capability;
			events.push('profile:start');
			return profileRuntime;
		});

		expect(result).toEqual({ kind: 'unlocked' });
		expect(bootstrap.state()).toBe('unlocked');
		expect(issuedCapability).not.toBeNull();
		expect(JSON.stringify(issuedCapability)).toBeUndefined();
		expect(events).toEqual(['vault:open', 'profile:start']);
	});

	test('leaves the profile closed when vault access is rejected', async () => {
		const accessAdapter: VaultAccessAdapter = {
			create: jest.fn(),
			unlock: async () => ({ kind: 'rejected', reason: 'wrongCredential' }),
			recover: jest.fn(),
		};
		const initializeProfile = jest.fn();
		const bootstrap = new PreProfileVaultBootstrap(accessAdapter);

		const result = await bootstrap.start('unlock', initializeProfile);

		expect(result).toEqual({ kind: 'rejected', reason: 'wrongCredential' });
		expect(bootstrap.state()).toBe('locked');
		expect(initializeProfile).not.toHaveBeenCalled();
	});

	test.each([
		'corruptVault',
		'unsupportedVersion',
	] as const)('fails closed on %s without starting the profile', async reason => {
		const accessAdapter: VaultAccessAdapter = {
			create: jest.fn(),
			unlock: async () => ({ kind: 'failedClosed', reason }),
			recover: jest.fn(),
		};
		const initializeProfile = jest.fn();
		const bootstrap = new PreProfileVaultBootstrap(accessAdapter);

		const result = await bootstrap.start('unlock', initializeProfile);

		expect(result).toEqual({ kind: 'failedClosed', stage: 'vaultAccess', reason });
		expect(bootstrap.state()).toBe('failedClosed');
		expect(initializeProfile).not.toHaveBeenCalled();
	});

	test('starts a recovered vault through the same profile gate', async () => {
		const recover = jest.fn(async () => ({
			kind: 'opened' as const,
			handle: { close: jest.fn() },
		}));
		const accessAdapter: VaultAccessAdapter = {
			create: jest.fn(),
			unlock: jest.fn(),
			recover,
		};
		const initializeProfile = jest.fn(async () => ({
			stop: async () => ({ kind: 'stopped' as const }),
		}));
		const bootstrap = new PreProfileVaultBootstrap(accessAdapter);

		const result = await bootstrap.start('recover', initializeProfile);

		expect(result).toEqual({ kind: 'unlocked' });
		expect(recover).toHaveBeenCalledTimes(1);
		expect(initializeProfile).toHaveBeenCalledTimes(1);
	});

	test('fails closed without exposing adapter errors', async () => {
		const accessAdapter: VaultAccessAdapter = {
			create: jest.fn(),
			unlock: async () => {
				throw new Error('secret adapter detail');
			},
			recover: jest.fn(),
		};
		const initializeProfile = jest.fn();
		const bootstrap = new PreProfileVaultBootstrap(accessAdapter);

		const result = await bootstrap.start('unlock', initializeProfile);

		expect(result).toEqual({ kind: 'failedClosed', stage: 'vaultAccess' });
		expect(bootstrap.state()).toBe('failedClosed');
		expect(initializeProfile).not.toHaveBeenCalled();
		expect(JSON.stringify(result)).not.toContain('secret adapter detail');
	});

	test('closes the vault when profile initialization fails', async () => {
		const closeVault = jest.fn();
		const accessAdapter: VaultAccessAdapter = {
			create: async () => ({
				kind: 'opened',
				handle: { close: closeVault },
			}),
			unlock: jest.fn(),
			recover: jest.fn(),
		};
		const bootstrap = new PreProfileVaultBootstrap(accessAdapter);

		const result = await bootstrap.start('create', async () => {
			throw new Error('profile startup detail');
		});

		expect(result).toEqual({ kind: 'failedClosed', stage: 'profileStart' });
		expect(bootstrap.state()).toBe('failedClosed');
		expect(closeVault).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(result)).not.toContain('profile startup detail');
	});

	test('stops the profile before closing the vault', async () => {
		const events: string[] = [];
		const accessAdapter: VaultAccessAdapter = {
			create: async () => ({
				kind: 'opened',
				handle: {
					close: async () => {
						events.push('vault:close');
					},
				},
			}),
			unlock: jest.fn(),
			recover: jest.fn(),
		};
		const bootstrap = new PreProfileVaultBootstrap(accessAdapter);
		await bootstrap.start('create', async () => ({
			stop: async reason => {
				events.push(`profile:${reason}`);
				return { kind: 'stopped' };
			},
		}));

		const result = await bootstrap.end('lock');

		expect(result).toEqual({ kind: 'locked' });
		expect(bootstrap.state()).toBe('locked');
		expect(events).toEqual(['profile:lock', 'vault:close']);
	});

	test('reports egress residue after closing the vault', async () => {
		const closeVault = jest.fn();
		const accessAdapter: VaultAccessAdapter = {
			create: async () => ({
				kind: 'opened',
				handle: { close: closeVault },
			}),
			unlock: jest.fn(),
			recover: jest.fn(),
		};
		const bootstrap = new PreProfileVaultBootstrap(accessAdapter);
		await bootstrap.start('create', async () => ({
			stop: async () => ({
				kind: 'egressResidue',
				paths: ['C:\\Users\\person\\exported-note.md'],
			}),
		}));

		const result = await bootstrap.end('close');

		expect(result).toEqual({
			kind: 'lockedWithEgressResidue',
			paths: ['C:\\Users\\person\\exported-note.md'],
		});
		expect(bootstrap.state()).toBe('lockedWithEgressResidue');
		expect(closeVault).toHaveBeenCalledTimes(1);
	});

	test('fails closed and still closes the vault when profile teardown fails', async () => {
		const closeVault = jest.fn();
		const accessAdapter: VaultAccessAdapter = {
			create: async () => ({
				kind: 'opened',
				handle: { close: closeVault },
			}),
			unlock: jest.fn(),
			recover: jest.fn(),
		};
		const bootstrap = new PreProfileVaultBootstrap(accessAdapter);
		await bootstrap.start('create', async () => ({
			stop: async () => {
				throw new Error('profile teardown detail');
			},
		}));

		const result = await bootstrap.end('close');

		expect(result).toEqual({ kind: 'failedClosed', stage: 'profileStop' });
		expect(bootstrap.state()).toBe('failedClosed');
		expect(closeVault).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(result)).not.toContain('profile teardown detail');
	});

	test('fails closed without exposing vault-close errors', async () => {
		const accessAdapter: VaultAccessAdapter = {
			create: async () => ({
				kind: 'opened',
				handle: {
					close: async () => {
						throw new Error('vault close detail');
					},
				},
			}),
			unlock: jest.fn(),
			recover: jest.fn(),
		};
		const bootstrap = new PreProfileVaultBootstrap(accessAdapter);
		await bootstrap.start('create', async () => ({
			stop: async () => ({ kind: 'stopped' }),
		}));

		const result = await bootstrap.end('lock');

		expect(result).toEqual({ kind: 'failedClosed', stage: 'vaultClose' });
		expect(bootstrap.state()).toBe('failedClosed');
		expect(JSON.stringify(result)).not.toContain('vault close detail');
	});

	test('rejects a second profile start while already unlocked', async () => {
		const accessAdapter: VaultAccessAdapter = {
			create: jest.fn(async () => ({
				kind: 'opened' as const,
				handle: { close: jest.fn() },
			})),
			unlock: jest.fn(),
			recover: jest.fn(),
		};
		const initializeProfile = jest.fn(async () => ({
			stop: async () => ({ kind: 'stopped' as const }),
		}));
		const bootstrap = new PreProfileVaultBootstrap(accessAdapter);
		await bootstrap.start('create', initializeProfile);

		const result = await bootstrap.start('create', initializeProfile);

		expect(result).toEqual({ kind: 'rejected', reason: 'alreadyUnlocked' });
		expect(accessAdapter.create).toHaveBeenCalledTimes(1);
		expect(initializeProfile).toHaveBeenCalledTimes(1);
		expect(bootstrap.state()).toBe('unlocked');
	});

	test('rejects lock before a vault session exists', async () => {
		const accessAdapter: VaultAccessAdapter = {
			create: jest.fn(),
			unlock: jest.fn(),
			recover: jest.fn(),
		};
		const bootstrap = new PreProfileVaultBootstrap(accessAdapter);

		const result = await bootstrap.end('lock');

		expect(result).toEqual({ kind: 'rejected', reason: 'alreadyLocked' });
		expect(bootstrap.state()).toBe('locked');
	});
});
