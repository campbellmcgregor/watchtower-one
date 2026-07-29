import Logger from '@joplin/utils/Logger';
import shim from '../../shim';
import Setting from '../Setting';

const logger = Logger.create('Settings');

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Old code before rule was applied
export type SettingValues = Record<string, any>;

export interface SettingsFileHandler {
	load(): Promise<SettingValues>;
	save(values: SettingValues): Promise<void>;
}

export interface SettingsFileStorage {
	readonly description: string;
	read(): Promise<string|undefined>;
	write(content: string): Promise<void>;
	handleInvalid?(error: unknown): Promise<SettingValues>;
}

export default class FileHandler implements SettingsFileHandler {

	private storage_: SettingsFileStorage;
	private valueJsonCache_: string = null;
	private parsedJsonCache_: SettingValues = null;

	public constructor(storage: string|SettingsFileStorage) {
		if (typeof storage === 'string') {
			const filePath = storage;
			this.storage_ = {
				description: filePath,
				read: async () => {
					if (!(await shim.fsDriver().exists(filePath))) return undefined;
					return shim.fsDriver().readFile(filePath, 'utf8');
				},
				write: content => shim.fsDriver().writeFile(filePath, content, 'utf8'),
				handleInvalid: async error => {
					logger.error(`Could not parse JSON file: ${filePath}`, error);
					await shim.fsDriver().move(filePath, `${filePath}-${Date.now()}-invalid.bak`);
					return {};
				},
			};
		} else {
			this.storage_ = storage;
		}
	}

	public async load(): Promise<SettingValues> {
		if (!this.valueJsonCache_) {
			this.valueJsonCache_ = await this.storage_.read() ?? '{}';
			this.parsedJsonCache_ = null;
		}

		if (this.parsedJsonCache_) return this.parsedJsonCache_;

		let result: SettingValues;
		try {
			const values = JSON.parse(this.valueJsonCache_);
			delete values['$id'];
			delete values['$schema'];
			result = values;
		} catch (error) {
			if (!this.storage_.handleInvalid) {
				throw new Error(`Could not parse ${this.storage_.description}`);
			}
			result = await this.storage_.handleInvalid(error);
		}

		this.parsedJsonCache_ = result;

		return result;
	}

	public async save(values: SettingValues) {
		values = { ...values };

		// Merge with existing settings. This prevents settings stored by disabled or not-yet-loaded
		// plugins from being deleted.
		for (const key in this.parsedJsonCache_) {
			const includesSetting = Object.prototype.hasOwnProperty.call(values, key);
			if (!includesSetting) {
				values[key] = this.parsedJsonCache_[key];
			}
		}

		const json = `${JSON.stringify({
			'$schema': Setting.schemaUrl,
			...values,
		}, null, '\t')}\n`;

		if (json === this.valueJsonCache_) return;

		await this.storage_.write(json);
		this.valueJsonCache_ = json;
	}

}
