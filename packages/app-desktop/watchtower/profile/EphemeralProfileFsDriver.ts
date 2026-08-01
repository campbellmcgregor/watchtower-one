import FsDriverNode from '@joplin/lib/fs-driver-node';
import { ProfileRuntimeFileSystem } from '@joplin/lib/profileStorageBinding';
import { ReadDirStatsOptions, RemoveOptions, Stat } from '@joplin/lib/fs-driver-base';
import { dirname } from '@joplin/lib/path-utils';
import { createHash } from 'crypto';
import {
	EphemeralArtifactCategory,
	EphemeralProfileArtifacts,
} from './profileStorageTypes';

interface EphemeralFileMetadata {
	birthtime: Date;
	mtime: Date;
}

interface EphemeralReadHandle {
	readonly kind: 'watchtower-ephemeral-read';
	readonly content: Buffer;
	offset: number;
}

const isEphemeralReadHandle = (value: unknown): value is EphemeralReadHandle => {
	return !!value && typeof value === 'object' &&
		(value as EphemeralReadHandle).kind === 'watchtower-ephemeral-read';
};

const temporaryRoot = 'watchtower-memory://temporary';
const cacheRoot = 'watchtower-memory://cache';

const normalise = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '');

const missingPath = (path: string) => {
	const error = new Error(`No such ephemeral file or directory: ${path}`) as Error & { code: string };
	error.code = 'ENOENT';
	return error;
};

export default class EphemeralProfileFsDriver extends FsDriverNode implements ProfileRuntimeFileSystem {

	private readonly directories_ = new Set([temporaryRoot, cacheRoot]);
	private readonly files_ = new Map<string, EphemeralFileMetadata>();

	public constructor(private readonly artifacts_: EphemeralProfileArtifacts) {
		super();
	}

	public cacheDirectory() {
		return cacheRoot;
	}

	public temporaryDirectory() {
		return temporaryRoot;
	}

	private address(path: string): { category: EphemeralArtifactCategory; key: string }|undefined {
		path = normalise(path);
		for (const [root, category] of [
			[temporaryRoot, 'temporary'],
			[cacheRoot, 'cache'],
		] as const) {
			if (path === root || path.startsWith(`${root}/`)) {
				return {
					category,
					key: Buffer.from(path.slice(root.length) || '/', 'utf8').toString('base64url'),
				};
			}
		}
		return undefined;
	}

	private isEphemeral(path: string) {
		return !!this.address(path);
	}

	private async readBuffer(path: string): Promise<Buffer> {
		path = normalise(path);
		const address = this.address(path)!;
		const content = await this.artifacts_.read(address.category, address.key);
		if (!content || !this.files_.has(path)) throw missingPath(path);
		return Buffer.from(content);
	}

	public async mkdir(path: string) {
		if (!this.isEphemeral(path)) return super.mkdir(path);
		path = normalise(path);
		const root = path.startsWith(temporaryRoot) ? temporaryRoot : cacheRoot;
		let current = root;
		for (const part of path.slice(root.length).split('/').filter(Boolean)) {
			current = `${current}/${part}`;
			this.directories_.add(current);
		}
	}

	public async writeFile(path: string, content: string, encoding = 'base64') {
		if (!this.isEphemeral(path)) return super.writeFile(path, content, encoding);
		path = normalise(path);
		if (!this.directories_.has(normalise(dirname(path)))) throw missingPath(dirname(path));
		const data = encoding === 'buffer' || encoding === 'Buffer' ?
			Buffer.from(content) : Buffer.from(content, encoding as BufferEncoding);
		const now = new Date();
		const previous = this.files_.get(path);
		this.files_.set(path, { birthtime: previous?.birthtime ?? now, mtime: now });
		const address = this.address(path)!;
		await this.artifacts_.write(address.category, address.key, data);
	}

	public async appendFile(path: string, content: string, encoding = 'base64') {
		if (!this.isEphemeral(path)) return super.appendFile(path, content, encoding);
		const previous = this.files_.has(normalise(path)) ? await this.readBuffer(path) : Buffer.alloc(0);
		const incoming = Buffer.from(content, encoding as BufferEncoding);
		await this.writeFile(path, Buffer.concat([previous, incoming]) as unknown as string, 'buffer');
	}

	public async readFile(path: string, encoding = 'utf8') {
		if (!this.isEphemeral(path)) return super.readFile(path, encoding);
		const content = await this.readBuffer(path);
		return encoding === 'buffer' || encoding === 'Buffer' ? content : content.toString(encoding as BufferEncoding);
	}

	public async exists(path: string) {
		if (!this.isEphemeral(path)) return super.exists(path);
		path = normalise(path);
		return this.directories_.has(path) || this.files_.has(path);
	}

	public async stat(path: string): Promise<Stat|null> {
		if (!this.isEphemeral(path)) return super.stat(path);
		path = normalise(path);
		if (this.directories_.has(path)) {
			return {
				birthtime: new Date(0),
				mtime: new Date(0),
				isDirectory: () => true,
				path,
				size: 0,
			};
		}
		const metadata = this.files_.get(path);
		if (!metadata) return null;
		return {
			...metadata,
			isDirectory: () => false,
			path,
			size: (await this.readBuffer(path)).byteLength,
		};
	}

	public async readDirStats(path: string, options: ReadDirStatsOptions = { recursive: false }) {
		if (!this.isEphemeral(path)) return super.readDirStats(path, options);
		path = normalise(path);
		if (!this.directories_.has(path)) throw missingPath(path);
		const prefix = `${path}/`;
		const candidates = [...this.directories_, ...this.files_.keys()]
			.filter(candidate => candidate.startsWith(prefix))
			.filter(candidate => options?.recursive || !candidate.slice(prefix.length).includes('/'))
			.sort();
		const output: Stat[] = [];
		for (const candidate of candidates) {
			const stat = await this.stat(candidate);
			if (!stat) continue;
			stat.path = candidate.slice(prefix.length);
			output.push(stat);
		}
		return output;
	}

	public async remove(path: string, _options: RemoveOptions = null) {
		if (!this.isEphemeral(path)) return super.remove(path);
		path = normalise(path);
		const prefix = `${path}/`;
		for (const file of [...this.files_.keys()]) {
			if (file !== path && !file.startsWith(prefix)) continue;
			const address = this.address(file)!;
			await this.artifacts_.remove(address.category, address.key);
			this.files_.delete(file);
		}
		for (const directory of [...this.directories_]) {
			if (
				directory !== temporaryRoot &&
				directory !== cacheRoot &&
				(directory === path || directory.startsWith(prefix))
			) {
				this.directories_.delete(directory);
			}
		}
	}

	public async copy(source: string, destination: string) {
		if (!this.isEphemeral(source) && !this.isEphemeral(destination)) {
			return super.copy(source, destination);
		}
		const content = this.isEphemeral(source) ?
			await this.readBuffer(source) : await super.readFile(source, 'Buffer');
		await this.writeFile(destination, content as unknown as string, 'buffer');
	}

	public async move(source: string, destination: string) {
		if (!this.isEphemeral(source) && !this.isEphemeral(destination)) {
			return super.move(source, destination);
		}
		await this.copy(source, destination);
		await this.remove(source);
	}

	public async unlink(path: string) {
		if (!this.isEphemeral(path)) return super.unlink(path);
		await this.remove(path);
	}

	public async open(path: string, mode: string) {
		if (!this.isEphemeral(path)) return super.open(path, mode);
		if (mode !== 'r') throw new Error('Ephemeral file handles are read-only');
		return {
			kind: 'watchtower-ephemeral-read',
			content: await this.readBuffer(path),
			offset: 0,
		} satisfies EphemeralReadHandle;
	}

	public async readFileChunk(handle: unknown, length: number, encoding = 'base64') {
		if (!isEphemeralReadHandle(handle)) return super.readFileChunk(handle, length, encoding);
		const content = handle.content.subarray(handle.offset, handle.offset + length);
		handle.offset += content.byteLength;
		if (!content.byteLength) return null;
		if (encoding === 'base64' || encoding === 'ascii') return content.toString(encoding);
		throw new Error(`Unsupported encoding: ${encoding}`);
	}

	public async close(handle: unknown) {
		if (isEphemeralReadHandle(handle)) return;
		return super.close(handle);
	}

	public async md5File(path: string) {
		if (!this.isEphemeral(path)) return super.md5File(path);
		return createHash('md5').update(await this.readBuffer(path)).digest('hex');
	}
}
