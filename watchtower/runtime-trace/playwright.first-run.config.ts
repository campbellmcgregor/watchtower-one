export default {
	testDir: '.',
	testMatch: 'watchtower-first-run.spec.ts',
	fullyParallel: false,
	workers: 1,
	retries: 0,
	reporter: 'line',
	outputDir: '../../packages/app-desktop/test-results/watchtower-first-run-playwright',
	timeout: 7 * 60_000,
	use: {
		trace: 'retain-on-failure',
	},
};
