import FsDriverNode from '@joplin/lib/fs-driver-node';
import { ReadDirStatsOptions, RemoveOptions, Stat } from '@joplin/lib/fs-driver-base';
import { createHash } from 'crypto';
import { basename, isAbsolute, relative, resolve, sep } from 'path';
import {
	ResourceContent,
	ResourceContentKind,
	ResourceContentMetadata,
} from './profileStorageTypes';
import PlaintextEgressNotAuthorizedError from './PlaintextEgressNotAuthorizedError';

interface ResourceAddress {
	fileName: string;
	kind: ResourceContentKind;
	resourceId: string;
}

interface ResourceReadHandle {
	content: Buffer;
	position: number;
	readonly watchtowerResourceHandle: true;
}

const isResourceReadHandle = (handle: unknown): handle is ResourceReadHandle => {
	return (
		typeof handle === 'object' &&
		handle !== null &&
		(handle as ResourceReadHandle).watchtowerResourceHandle === true
	);
};

export default class EncryptedResourceFsDriver extends FsDriverNode {

	private readonly resourceDirectory_: string;

	public constructor(
		resourceDirectory: string,
		private readonly content_: ResourceContent,
	) {
		super();
		this.resourceDirectory_ = resolve(resourceDirectory);
	}

	private pathsEqual_(left: string, right: string) {
		return process.platform === 'win32' ?
			left.toLowerCase() === right.toLowerCase() :
			left === right;
	}

	private address_(path: string): ResourceAddress|undefined {
		const resolvedPath = resolve(path);
		const relativePath = relative(this.resourceDirectory_, resolvedPath);
		if (
			relativePath === '..' ||
			relativePath.startsWith(`..${sep}`) ||
			isAbsolute(relativePath) ||
			!this.pathsEqual_(resolve(this.resourceDirectory_, relativePath), resolvedPath)
		) {
			return undefined;
		}

		if (
			!relativePath ||
			relativePath.includes('/') ||
			relativePath.includes('\\')
		) {
			throw new Error('Encrypted resource path is invalid');
		}
		const match = /^([A-Za-z0-9]{32})(?:\.([A-Za-z0-9_-]+))?$/.exec(relativePath);
		if (!match) throw new Error('Encrypted resource path is invalid');
		return {
			fileName: relativePath,
			kind: match[2]?.toLowerCase() === 'crypted' ? 'syncCiphertext' : 'content',
			resourceId: match[1],
		};
	}

	private isResourceDirectory_(path: string) {
		return this.pathsEqual_(resolve(path), this.resourceDirectory_);
	}

	private isWithinResourceDirectory_(path: string) {
		const relativePath = relative(this.resourceDirectory_, resolve(path));
		return (
			relativePath !== '..' &&
			!relativePath.startsWith(`..${sep}`) &&
			!isAbsolute(relativePath)
		);
	}

	private async metadata_(address: ResourceAddress) {
		return this.content_.metadata(address.resourceId, address.kind);
	}

	private statFromMetadata_(
		path: string,
		metadata: ResourceContentMetadata,
	): Stat {
		const updatedTime = new Date(metadata.updatedTime);
		return {
			birthtime: updatedTime,
			mtime: updatedTime,
			isDirectory: () => false,
			path,
			size: metadata.size,
		};
	}

	private inputBuffer_(input: string|Uint8Array, encoding: string) {
		if (Buffer.isBuffer(input) || input instanceof Uint8Array) return Buffer.from(input);
		if (encoding === 'buffer') return Buffer.from(input);
		return Buffer.from(input, encoding as BufferEncoding);
	}

	private outputContent_(content: Buffer, encoding: string) {
		if (encoding === 'Buffer' || encoding === 'buffer') return Buffer.from(content);
		return content.toString(encoding as BufferEncoding);
	}

	public async appendFile(path: string, input: string, encoding = 'base64') {
		const address = this.address_(path);
		if (!address) return super.appendFile(path, input, encoding);

		const metadata = await this.metadata_(address);
		const current = metadata ?
			await this.content_.read(address.resourceId, address.kind) :
			Buffer.alloc(0);
		const appended = Buffer.concat([current, this.inputBuffer_(input, encoding)]);
		await this.content_.import(
			address.resourceId,
			appended,
			address.kind,
			address.fileName,
		);
	}

	public appendFileSync(path: string, input: string) {
		if (this.isWithinResourceDirectory_(path)) {
			throw new Error('Encrypted resource path is invalid');
		}
		return super.appendFileSync(path, input);
	}

	public async writeFile(
		path: string,
		input: string|Uint8Array,
		encoding = 'base64',
	): Promise<void> {
		const address = this.address_(path);
		if (!address) {
			await super.writeFile(path, input as string, encoding);
			return;
		}
		await this.content_.import(
			address.resourceId,
			this.inputBuffer_(input, encoding),
			address.kind,
			address.fileName,
		);
	}

	public async readFile(path: string, encoding = 'utf8') {
		const address = this.address_(path);
		if (!address) return super.readFile(path, encoding);
		return this.outputContent_(
			await this.content_.read(address.resourceId, address.kind),
			encoding,
		);
	}

	public async exists(path: string) {
		if (this.isResourceDirectory_(path)) return true;
		const address = this.address_(path);
		if (!address) return super.exists(path);
		return !!await this.metadata_(address);
	}

	public async stat(path: string): Promise<Stat> {
		if (this.isResourceDirectory_(path)) {
			const now = new Date();
			return {
				birthtime: now,
				mtime: now,
				isDirectory: () => true,
				path,
				size: 0,
			};
		}
		const address = this.address_(path);
		if (!address) return super.stat(path);
		const metadata = await this.metadata_(address);
		return metadata ? this.statFromMetadata_(path, metadata) : null;
	}

	public async readDirStats(
		path: string,
		_options: ReadDirStatsOptions = null,
	): Promise<Stat[]> {
		if (!this.isResourceDirectory_(path)) {
			if (this.isWithinResourceDirectory_(path)) {
				throw new Error('Encrypted resource path is invalid');
			}
			return super.readDirStats(path, _options);
		}
		const metadata = await this.content_.list();
		return metadata.map(item => this.statFromMetadata_(
			item.fileName ?? (
				item.kind === 'syncCiphertext' ?
					`${item.resourceId}.crypted` :
					item.resourceId
			),
			item,
		));
	}

	public async mkdir(path: string) {
		if (this.isResourceDirectory_(path)) return;
		if (this.isWithinResourceDirectory_(path)) {
			throw new Error('Encrypted resource path is invalid');
		}
		return super.mkdir(path);
	}

	public async remove(path: string, _options: RemoveOptions = null): Promise<void> {
		if (this.isResourceDirectory_(path)) {
			throw new Error('Encrypted resource storage is removed by the vault lifecycle');
		}
		const address = this.address_(path);
		if (!address) {
			await super.remove(path);
			return;
		}
		await this.content_.remove(address.resourceId, address.kind);
	}

	public async unlink(path: string) {
		const address = this.address_(path);
		if (!address) return super.unlink(path);
		await this.content_.remove(address.resourceId, address.kind);
	}

	public async copy(source: string, destination: string) {
		const sourceAddress = this.address_(source);
		const destinationAddress = this.address_(destination);
		if (sourceAddress && !destinationAddress) throw new PlaintextEgressNotAuthorizedError();
		if (!sourceAddress && !destinationAddress) return super.copy(source, destination);

		const content = sourceAddress ?
			await this.content_.read(sourceAddress.resourceId, sourceAddress.kind) :
			await super.readFile(source, 'Buffer');
		await this.content_.import(
			destinationAddress!.resourceId,
			content,
			destinationAddress!.kind,
			destinationAddress!.fileName,
		);
	}

	public async move(source: string, destination: string) {
		const sourceAddress = this.address_(source);
		const destinationAddress = this.address_(destination);
		if (sourceAddress && !destinationAddress) throw new PlaintextEgressNotAuthorizedError();
		if (!sourceAddress && !destinationAddress) return super.move(source, destination);

		await this.copy(source, destination);
		if (sourceAddress) {
			await this.content_.remove(sourceAddress.resourceId, sourceAddress.kind);
		} else {
			await super.remove(source);
		}
	}

	public async open(path: string, mode: string) {
		const address = this.address_(path);
		if (!address) return super.open(path, mode);
		if (mode !== 'r') throw new Error('Encrypted resource handles are read-only');
		return {
			content: await this.content_.read(address.resourceId, address.kind),
			position: 0,
			watchtowerResourceHandle: true as const,
		};
	}

	public async close(handle: unknown) {
		if (isResourceReadHandle(handle)) {
			handle.content.fill(0);
			handle.position = 0;
			return;
		}
		return super.close(handle);
	}

	public async readFileChunk(handle: unknown, length: number, encoding = 'base64') {
		if (!isResourceReadHandle(handle)) return super.readFileChunk(handle, length, encoding);
		if (!Number.isSafeInteger(length) || length < 0) throw new Error('Invalid resource chunk size');
		if (handle.position >= handle.content.byteLength) return null;
		const content = handle.content.subarray(handle.position, handle.position + length);
		handle.position += content.byteLength;
		if (encoding === 'base64' || encoding === 'ascii') return content.toString(encoding);
		throw new Error(`Unsupported encoding: ${encoding}`);
	}

	public async setTimestamp(path: string, timestampDate: Date) {
		const address = this.address_(path);
		if (!address) return super.setTimestamp(path, timestampDate);
		await this.content_.touch(address.resourceId, address.kind, timestampDate.getTime());
	}

	public async chmod(path: string, mode: string|number) {
		if (this.address_(path)) return;
		return super.chmod(path, mode);
	}

	public async md5File(path: string) {
		const address = this.address_(path);
		if (!address) return super.md5File(path);
		return createHash('md5')
			.update(await this.content_.read(address.resourceId, address.kind))
			.digest('hex');
	}

	public resourceDirectory() {
		return this.resourceDirectory_;
	}

	public resolveResourceFileName(path: string) {
		const address = this.address_(path);
		return address ? basename(address.fileName) : undefined;
	}
}
