// eslint-disable-next-line @typescript-eslint/no-var-requires -- Runtime module is loaded by the plain-JavaScript plugin host.
const createPluginDataFsProxy = require('./PluginDataFsProxy.js');

describe('PluginDataFsProxy', () => {
	test('presents fs-extra-compatible async file operations inside one virtual root', async () => {
		const requests: unknown[] = [];
		const proxy = createPluginDataFsProxy(
			'/watchtower-plugin-data/watchtower.example',
			async (request: { operation: string }) => {
				requests.push(request);
				if (request.operation === 'readFile') {
					return {
						contentBase64: Buffer.from('{"theme":"dark"}').toString('base64'),
					};
				}
				if (request.operation === 'readdir') return ['preferences.json'];
				if (request.operation === 'stat') return { kind: 'file', size: 6 };
				return undefined;
			},
		);

		await proxy.writeJson(
			'\\watchtower-plugin-data\\watchtower.example\\settings\\preferences.json',
			{ theme: 'dark' },
		);
		await expect(proxy.readJson(
			'/watchtower-plugin-data/watchtower.example/settings/preferences.json',
		)).resolves.toEqual({ theme: 'dark' });
		await expect(proxy.readdir(
			'/watchtower-plugin-data/watchtower.example/settings',
		)).resolves.toEqual(['preferences.json']);
		await proxy.ensureDir('/watchtower-plugin-data/watchtower.example/exports');
		await proxy.outputFile(
			'/watchtower-plugin-data/watchtower.example/exports/report.txt',
			Buffer.from('report'),
		);
		const report = await proxy.stat(
			'/watchtower-plugin-data/watchtower.example/exports/report.txt',
		);
		expect(report.size).toBe(6);
		expect(report.isFile()).toBe(true);
		expect(report.isDirectory()).toBe(false);
		await expect(proxy.pathExists(
			'/watchtower-plugin-data/another-plugin/preferences.json',
		)).rejects.toThrow('outside its encrypted data directory');

		expect(requests).toEqual([
			{
				operation: 'writeFile',
				path: 'settings/preferences.json',
				contentBase64: Buffer.from('{\n  "theme": "dark"\n}\n').toString('base64'),
			},
			{ operation: 'readFile', path: 'settings/preferences.json' },
			{ operation: 'readdir', path: 'settings' },
			{ operation: 'ensureDir', path: 'exports' },
			{
				operation: 'outputFile',
				path: 'exports/report.txt',
				contentBase64: Buffer.from('report').toString('base64'),
			},
			{ operation: 'stat', path: 'exports/report.txt' },
		]);
	});
});
