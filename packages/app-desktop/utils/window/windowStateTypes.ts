export interface WindowBounds {
	x?: number;
	y?: number;
	width: number;
	height: number;
}

export interface WindowStateManagedWindow {
	getBounds(): WindowBounds;
	isMaximized(): boolean;
	isMinimized(): boolean;
	isFullScreen(): boolean;
	maximize(): void;
	setFullScreen(value: boolean): void;
	on(event: string, listener: ()=> void): unknown;
	removeListener(event: string, listener: ()=> void): unknown;
}

export interface WindowStateOptions {
	defaultWidth: number;
	defaultHeight: number;
	file?: string;
	path?: string;
}

export interface WindowStateKeeper {
	readonly x?: number;
	readonly y?: number;
	readonly width: number;
	readonly height: number;
	manage(window: WindowStateManagedWindow): void;
}

export interface WindowStateFactory {
	create(options: WindowStateOptions): WindowStateKeeper;
}
