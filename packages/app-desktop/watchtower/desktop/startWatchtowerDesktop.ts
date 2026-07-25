import PreProfileVaultBootstrap, {
	ProfileHost,
	VaultAccessAdapter,
	VaultAccessOperation,
	VaultBootstrapOptions,
	VaultStartResult,
} from '../vault/PreProfileVaultBootstrap';

export interface WatchtowerDesktopDependencies {
	operation: VaultAccessOperation;
	accessAdapter: VaultAccessAdapter;
	profileHost: ProfileHost;
	options?: VaultBootstrapOptions;
}

export interface WatchtowerDesktopStart {
	lifecycle: PreProfileVaultBootstrap;
	result: VaultStartResult;
}

export const startWatchtowerDesktop = async (
	dependencies: WatchtowerDesktopDependencies,
): Promise<WatchtowerDesktopStart> => {
	const lifecycle = new PreProfileVaultBootstrap(
		dependencies.accessAdapter,
		dependencies.options,
	);
	return {
		lifecycle,
		result: await lifecycle.start(dependencies.operation, dependencies.profileHost),
	};
};

export const makeFailClosedDesktopDependencies = (): WatchtowerDesktopDependencies => {
	const unavailable = async (): Promise<never> => {
		throw new Error('Encrypted profile binding is unavailable');
	};

	return {
		operation: 'unlock',
		accessAdapter: {
			create: unavailable,
			unlock: unavailable,
			recover: unavailable,
			abort: () => true,
		},
		profileHost: {
			start: unavailable,
			stop: unavailable,
			terminate: () => true,
		},
	};
};
