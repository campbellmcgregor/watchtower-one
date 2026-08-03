import RendererProfileCloseCoordinator from './RendererProfileCloseCoordinator';

describe('RendererProfileCloseCoordinator', () => {
	test('waits for the renderer to finish saving before allowing profile teardown', async () => {
		const coordinator = new RendererProfileCloseCoordinator(5_000);
		const sendCloseRequest = jest.fn();

		const result = coordinator.request(sendCloseRequest);
		expect(sendCloseRequest).toHaveBeenCalledTimes(1);
		expect(coordinator.accept({ canClose: false })).toBe(true);

		await expect(Promise.race([
			result,
			Promise.resolve('pending'),
		])).resolves.toBe('pending');

		expect(coordinator.accept({ canClose: true })).toBe(true);
		await expect(result).resolves.toBe('ready');
	});

	test('bounds the drain before a forced profile teardown', async () => {
		jest.useFakeTimers();
		try {
			const coordinator = new RendererProfileCloseCoordinator(5_000);
			const result = coordinator.request(jest.fn());

			jest.advanceTimersByTime(5_000);

			await expect(result).resolves.toBe('timeout');
			expect(coordinator.accept({ canClose: true })).toBe(false);
		} finally {
			jest.useRealTimers();
		}
	});
});
