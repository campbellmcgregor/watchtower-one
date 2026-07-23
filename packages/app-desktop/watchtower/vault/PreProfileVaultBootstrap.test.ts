import PreProfileVaultBootstrap, {
	ProfileHost,
	VaultAccessAdapter,
	VaultOpenHandle,
	VaultSessionCapability,
	VaultSessionLease,
} from './PreProfileVaultBootstrap';

const makeOpenHandle = (overrides: Partial<VaultOpenHandle> = {}): VaultOpenHandle => ({
	close: async () => {},
	terminate: () => true,
	...overrides,
});

const makeAccessAdapter = (
	overrides: Partial<VaultAccessAdapter> = {},
): VaultAccessAdapter => ({
	create: async () => ({ kind: 'rejected', reason: 'alreadyExists' }),
	unlock: async () => ({ kind: 'rejected', reason: 'missingVault' }),
	recover: async () => ({ kind: 'rejected', reason: 'recoveryRejected' }),
	abort: () => true,
	...overrides,
});

const makeProfileHost = (overrides: Partial<ProfileHost> = {}): ProfileHost => ({
	start: async () => {},
	stop: async () => ({ kind: 'stopped' }),
	terminate: () => true,
	...overrides,
});

describe('PreProfileVaultBootstrap', () => {
	afterEach(() => {
		jest.useRealTimers();
	});

	test('starts the profile only after the vault is open', async () => {
		const events: string[] = [];
		const accessAdapter = makeAccessAdapter({
			create: async () => {
				events.push('vault:open');
				return { kind: 'opened', handle: makeOpenHandle() };
			},
		});
		let issuedCapability: VaultSessionCapability|null = null;
		const profileHost = makeProfileHost({
			start: async capability => {
				capability();
				issuedCapability = capability;
				events.push('profile:start');
			},
		});
		const bootstrap = new PreProfileVaultBootstrap(accessAdapter);

		const result = await bootstrap.start('create', profileHost);

		expect(result).toEqual({ kind: 'unlocked' });
		expect(bootstrap.state()).toBe('unlocked');
		expect(issuedCapability).not.toBeNull();
		expect(JSON.stringify(issuedCapability)).toBeUndefined();
		expect(events).toEqual(['vault:open', 'profile:start']);
	});

	test('leaves the profile closed when vault access is rejected', async () => {
		const accessAdapter = makeAccessAdapter({
			unlock: async () => ({ kind: 'rejected', reason: 'wrongCredential' }),
		});
		const profileHost = makeProfileHost({ start: jest.fn() });
		const bootstrap = new PreProfileVaultBootstrap(accessAdapter);

		const result = await bootstrap.start('unlock', profileHost);

		expect(result).toEqual({ kind: 'rejected', reason: 'wrongCredential' });
		expect(bootstrap.state()).toBe('locked');
		expect(profileHost.start).not.toHaveBeenCalled();
	});

	test.each([
		'corruptVault',
		'unsupportedVersion',
	] as const)('fails closed on %s without starting the profile', async reason => {
		const accessAdapter = makeAccessAdapter({
			unlock: async () => ({ kind: 'failedClosed', reason }),
		});
		const profileHost = makeProfileHost({ start: jest.fn() });
		const bootstrap = new PreProfileVaultBootstrap(accessAdapter);

		const result = await bootstrap.start('unlock', profileHost);

		expect(result).toEqual({ kind: 'failedClosed', stage: 'vaultAccess', reason });
		expect(bootstrap.state()).toBe('failedClosed');
		expect(profileHost.start).not.toHaveBeenCalled();
	});

	test('starts a recovered vault through the same profile gate', async () => {
		const recover = jest.fn(async () => ({
			kind: 'opened' as const,
			handle: makeOpenHandle(),
		}));
		const profileHost = makeProfileHost({ start: jest.fn() });
		const bootstrap = new PreProfileVaultBootstrap(makeAccessAdapter({ recover }));

		const result = await bootstrap.start('recover', profileHost);

		expect(result).toEqual({ kind: 'unlocked' });
		expect(recover).toHaveBeenCalledTimes(1);
		expect(profileHost.start).toHaveBeenCalledTimes(1);
	});

	test('fails closed without exposing adapter errors', async () => {
		const abortAccess = jest.fn(() => true);
		const accessAdapter = makeAccessAdapter({
			unlock: async () => {
				throw new Error('secret adapter detail');
			},
			abort: abortAccess,
		});
		const profileHost = makeProfileHost({ start: jest.fn() });
		const bootstrap = new PreProfileVaultBootstrap(accessAdapter);

		const result = await bootstrap.start('unlock', profileHost);

		expect(result).toEqual({ kind: 'failedClosed', stage: 'vaultAccess' });
		expect(bootstrap.state()).toBe('failedClosed');
		expect(abortAccess).toHaveBeenCalledWith('unlock');
		expect(profileHost.start).not.toHaveBeenCalled();
		expect(JSON.stringify(result)).not.toContain('secret adapter detail');
	});

	test('closes the vault when profile startup fails', async () => {
		const closeVault = jest.fn(async () => {});
		const bootstrap = new PreProfileVaultBootstrap(makeAccessAdapter({
			create: async () => ({
				kind: 'opened',
				handle: makeOpenHandle({ close: closeVault }),
			}),
		}));

		const result = await bootstrap.start('create', makeProfileHost({
			start: async () => {
				throw new Error('profile startup detail');
			},
		}));

		expect(result).toEqual({ kind: 'failedClosed', stage: 'profileStart' });
		expect(bootstrap.state()).toBe('failedClosed');
		expect(closeVault).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(result)).not.toContain('profile startup detail');
	});

	test('stops the profile before closing the vault', async () => {
		const events: string[] = [];
		const bootstrap = new PreProfileVaultBootstrap(makeAccessAdapter({
			create: async () => ({
				kind: 'opened',
				handle: makeOpenHandle({
					close: async () => {
						events.push('vault:close');
					},
				}),
			}),
		}));
		await bootstrap.start('create', makeProfileHost({
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
		const closeVault = jest.fn(async () => {});
		const bootstrap = new PreProfileVaultBootstrap(makeAccessAdapter({
			create: async () => ({
				kind: 'opened',
				handle: makeOpenHandle({ close: closeVault }),
			}),
		}));
		await bootstrap.start('create', makeProfileHost({
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

	test('terminates the profile before closing the vault when teardown fails', async () => {
		const events: string[] = [];
		const bootstrap = new PreProfileVaultBootstrap(makeAccessAdapter({
			create: async () => ({
				kind: 'opened',
				handle: makeOpenHandle({
					close: async () => {
						events.push('vault:close');
					},
				}),
			}),
		}));
		await bootstrap.start('create', makeProfileHost({
			stop: async () => {
				throw new Error('profile teardown detail');
			},
			terminate: () => {
				events.push('profile:terminate');
				return true;
			},
		}));

		const result = await bootstrap.end('close');

		expect(result).toEqual({ kind: 'failedClosed', stage: 'profileStop' });
		expect(bootstrap.state()).toBe('failedClosed');
		expect(events).toEqual(['profile:terminate', 'vault:close']);
		expect(JSON.stringify(result)).not.toContain('profile teardown detail');
	});

	test('fails closed without exposing vault-close errors', async () => {
		const terminateVault = jest.fn(() => true);
		const bootstrap = new PreProfileVaultBootstrap(makeAccessAdapter({
			create: async () => ({
				kind: 'opened',
				handle: makeOpenHandle({
					close: async () => {
						throw new Error('vault close detail');
					},
					terminate: terminateVault,
				}),
			}),
		}));
		await bootstrap.start('create', makeProfileHost());

		const result = await bootstrap.end('lock');

		expect(result).toEqual({ kind: 'failedClosed', stage: 'vaultClose' });
		expect(bootstrap.state()).toBe('failedClosed');
		expect(terminateVault).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(result)).not.toContain('vault close detail');
	});

	test('rejects a second profile start while already unlocked', async () => {
		const create = jest.fn(async () => ({
			kind: 'opened' as const,
			handle: makeOpenHandle(),
		}));
		const profileHost = makeProfileHost({ start: jest.fn() });
		const bootstrap = new PreProfileVaultBootstrap(makeAccessAdapter({ create }));
		await bootstrap.start('create', profileHost);

		const result = await bootstrap.start('create', profileHost);

		expect(result).toEqual({ kind: 'rejected', reason: 'alreadyUnlocked' });
		expect(create).toHaveBeenCalledTimes(1);
		expect(profileHost.start).toHaveBeenCalledTimes(1);
		expect(bootstrap.state()).toBe('unlocked');
	});

	test('rejects lock before a vault session exists', async () => {
		const bootstrap = new PreProfileVaultBootstrap(makeAccessAdapter());

		const result = await bootstrap.end('lock');

		expect(result).toEqual({ kind: 'rejected', reason: 'alreadyLocked' });
		expect(bootstrap.state()).toBe('locked');
	});

	test('gates new work while an existing lease drains, then revokes the lease', async () => {
		let retainedCapability: VaultSessionCapability|null = null;
		let retainedLease: VaultSessionLease|null = null;
		const profileHost = makeProfileHost({
			start: async capability => {
				retainedCapability = capability;
				retainedLease = capability();
			},
			stop: async () => {
				expect(() => retainedCapability!()).toThrow('Vault Session is not accepting new work');
				expect(() => retainedLease!()).not.toThrow();
				return { kind: 'stopped' };
			},
		});
		const bootstrap = new PreProfileVaultBootstrap(makeAccessAdapter({
			create: async () => ({ kind: 'opened', handle: makeOpenHandle() }),
		}));
		await bootstrap.start('create', profileHost);

		await bootstrap.end('lock');

		expect(() => retainedCapability!()).toThrow('Vault Session is not active');
		expect(() => retainedLease!()).toThrow('Vault Session is not active');
	});

	test('hard-terminates partial profile startup before closing the vault', async () => {
		const events: string[] = [];
		const bootstrap = new PreProfileVaultBootstrap(makeAccessAdapter({
			create: async () => ({
				kind: 'opened',
				handle: makeOpenHandle({
					close: async () => {
						events.push('vault:close');
					},
				}),
			}),
		}));

		const result = await bootstrap.start('create', makeProfileHost({
			start: async () => {
				events.push('profile:start');
				throw new Error('partial profile start');
			},
			terminate: () => {
				events.push('profile:terminate');
				return true;
			},
		}));

		expect(result).toEqual({ kind: 'failedClosed', stage: 'profileStart' });
		expect(events).toEqual(['profile:start', 'profile:terminate', 'vault:close']);
	});

	test('reports unconfirmed profile termination as the primary startup failure', async () => {
		const bootstrap = new PreProfileVaultBootstrap(makeAccessAdapter({
			create: async () => ({
				kind: 'opened',
				handle: makeOpenHandle({
					close: async () => {
						throw new Error('secondary vault close failure');
					},
				}),
			}),
		}));

		const result = await bootstrap.start('create', makeProfileHost({
			start: async () => {
				throw new Error('partial profile start');
			},
			terminate: () => false,
		}));

		expect(result).toEqual({ kind: 'failedClosed', stage: 'profileTerminate' });
	});

	test('times out and terminates profile startup that never settles', async () => {
		jest.useFakeTimers();
		const events: string[] = [];
		const bootstrap = new PreProfileVaultBootstrap(makeAccessAdapter({
			create: async () => ({
				kind: 'opened',
				handle: makeOpenHandle({
					close: async () => {
						events.push('vault:close');
					},
				}),
			}),
		}), { operationTimeoutMs: 100 });

		const startPromise = bootstrap.start('create', makeProfileHost({
			start: async () => await new Promise<void>(() => {}),
			terminate: () => {
				events.push('profile:terminate');
				return true;
			},
		}));
		await jest.advanceTimersByTimeAsync(100);

		await expect(startPromise).resolves.toEqual({
			kind: 'failedClosed',
			stage: 'profileStart',
			timedOut: true,
		});
		expect(events).toEqual(['profile:terminate', 'vault:close']);
		jest.useRealTimers();
	});

	test('times out and aborts vault access that never settles', async () => {
		jest.useFakeTimers();
		const abortAccess = jest.fn(() => true);
		const bootstrap = new PreProfileVaultBootstrap(makeAccessAdapter({
			unlock: async () => await new Promise(() => {}),
			abort: abortAccess,
		}), { operationTimeoutMs: 100 });

		const startPromise = bootstrap.start('unlock', makeProfileHost());
		await jest.advanceTimersByTimeAsync(100);

		await expect(startPromise).resolves.toEqual({
			kind: 'failedClosed',
			stage: 'vaultAccess',
			timedOut: true,
		});
		expect(abortAccess).toHaveBeenCalledWith('unlock');
		jest.useRealTimers();
	});

	test('reports when timed-out vault access cannot be terminated', async () => {
		jest.useFakeTimers();
		const bootstrap = new PreProfileVaultBootstrap(makeAccessAdapter({
			unlock: async () => await new Promise(() => {}),
			abort: () => false,
		}), { operationTimeoutMs: 100 });

		const startPromise = bootstrap.start('unlock', makeProfileHost());
		await jest.advanceTimersByTimeAsync(100);

		await expect(startPromise).resolves.toEqual({
			kind: 'failedClosed',
			stage: 'vaultAccessTerminate',
			timedOut: true,
		});
	});

	test('times out and terminates profile teardown that never settles', async () => {
		jest.useFakeTimers();
		const events: string[] = [];
		const bootstrap = new PreProfileVaultBootstrap(makeAccessAdapter({
			create: async () => ({
				kind: 'opened',
				handle: makeOpenHandle({
					close: async () => {
						events.push('vault:close');
					},
				}),
			}),
		}), { operationTimeoutMs: 100 });
		await bootstrap.start('create', makeProfileHost({
			stop: async () => await new Promise(() => {}),
			terminate: () => {
				events.push('profile:terminate');
				return true;
			},
		}));

		const endPromise = bootstrap.end('lock');
		await jest.advanceTimersByTimeAsync(100);

		await expect(endPromise).resolves.toEqual({
			kind: 'failedClosed',
			stage: 'profileStop',
			timedOut: true,
		});
		expect(events).toEqual(['profile:terminate', 'vault:close']);
		jest.useRealTimers();
	});

	test('times out and force-closes a vault that never settles', async () => {
		jest.useFakeTimers();
		const terminateVault = jest.fn(() => true);
		const bootstrap = new PreProfileVaultBootstrap(makeAccessAdapter({
			create: async () => ({
				kind: 'opened',
				handle: makeOpenHandle({
					close: async () => await new Promise(() => {}),
					terminate: terminateVault,
				}),
			}),
		}), { operationTimeoutMs: 100 });
		await bootstrap.start('create', makeProfileHost());

		const endPromise = bootstrap.end('close');
		await jest.advanceTimersByTimeAsync(100);

		await expect(endPromise).resolves.toEqual({
			kind: 'failedClosed',
			stage: 'vaultClose',
			timedOut: true,
		});
		expect(terminateVault).toHaveBeenCalledTimes(1);
		jest.useRealTimers();
	});
});
