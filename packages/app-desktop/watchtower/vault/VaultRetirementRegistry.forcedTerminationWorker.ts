import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import type { VaultSessionKeyRing } from './vaultKeyEnvelope';
import VaultRetirementRegistry, {
	VaultRetirementDurabilityPhase,
} from './VaultRetirementRegistry';

const [userDataDirectory, crashPoint] = process.argv.slice(2) as [
	string,
	VaultRetirementDurabilityPhase,
];
const vaultId = 'AAAAAAAAAAAAAAAAAAAAAA';
const keyRing: VaultSessionKeyRing = {
	withDerivedKey: async (_purpose, operation) => operation(Buffer.alloc(32, 0x5a)),
	dispose: () => {},
};

const run = async () => {
	const vaultDirectory = join(userDataDirectory, 'vault');
	await mkdir(vaultDirectory, { recursive: true });
	await writeFile(join(vaultDirectory, 'profile.sqlite'), 'encrypted bytes');
	const registry = VaultRetirementRegistry.withDurabilityObserver(
		userDataDirectory,
		{
			reached: async phase => {
				if (phase !== crashPoint) return;
				process.send?.({ phase });
				await new Promise(() => {});
			},
		},
	);
	await registry.retire(vaultId, keyRing);
};

void run().catch(error => {
	process.stderr.write(String(error));
	process.exit(1);
});
