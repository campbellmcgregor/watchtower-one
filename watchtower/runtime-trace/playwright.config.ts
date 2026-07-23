export default {
	testDir: '.',
	testMatch: 'joplin-v3.6.15.spec.ts',
	fullyParallel: false,
	workers: 1,
	retries: 0,
	reporter: 'line',
	outputDir: '../../packages/app-desktop/test-results/watchtower-runtime-trace',
	timeout: 5 * 60_000,
	use: {
		trace: 'off',
	},
};
