import { pathExists } from 'fs-extra';
import EphemeralProfileFsDriver from './EphemeralProfileFsDriver';
import { EphemeralArtifactCategory, EphemeralProfileArtifacts } from './profileStorageTypes';

const makeArtifacts = (): EphemeralProfileArtifacts => {
	const content = new Map<string, Buffer>();
	const address = (category: EphemeralArtifactCategory, key: string) => `${category}:${key}`;
	return {
		write: async (category, key, value) => {
			content.set(address(category, key), Buffer.from(value));
		},
		read: async (category, key) => content.get(address(category, key)),
		remove: async (category, key) => {
			content.delete(address(category, key));
		},
	};
};

describe('EphemeralProfileFsDriver', () => {
	test('keeps ordinary temporary file work in session memory', async () => {
		const driver = new EphemeralProfileFsDriver(makeArtifacts());
		const directory = `${driver.temporaryDirectory()}/preview`;
		const path = `${directory}/note.html`;

		await driver.mkdir(directory);
		await driver.writeFile(path, '<h1>Private', 'utf8');
		await driver.appendFile(path, ' notebook</h1>', 'utf8');

		expect(await driver.readFile(path, 'utf8')).toBe('<h1>Private notebook</h1>');
		expect((await driver.readDirStats(directory)).map(item => item.path)).toEqual([
			'note.html',
		]);
		await expect(pathExists(path)).resolves.toBe(false);

		await driver.remove(driver.temporaryDirectory());
		await expect(driver.exists(path)).resolves.toBe(false);
	});

	test('supports Joplin file transforms and chunked reads without host files', async () => {
		const driver = new EphemeralProfileFsDriver(makeArtifacts());
		const source = `${driver.cacheDirectory()}/source.txt`;
		const copied = `${driver.temporaryDirectory()}/copied.txt`;
		const moved = `${driver.temporaryDirectory()}/moved.txt`;
		await driver.writeFile(source, 'hello', 'utf8');

		await driver.copy(source, copied);
		await driver.move(copied, moved);
		const handle = await driver.open(moved, 'r');

		expect(await driver.readFileChunk(handle, 2, 'ascii')).toBe('he');
		expect(await driver.readFileChunk(handle, 3, 'ascii')).toBe('llo');
		expect(await driver.readFileChunk(handle, 1, 'ascii')).toBeNull();
		expect(await driver.md5File(moved)).toBe('5d41402abc4b2a76b9719d911017c592');
		await driver.close(handle);
		await driver.unlink(moved);
		await expect(driver.exists(moved)).resolves.toBe(false);
		await expect(pathExists(moved)).resolves.toBe(false);
	});
});
