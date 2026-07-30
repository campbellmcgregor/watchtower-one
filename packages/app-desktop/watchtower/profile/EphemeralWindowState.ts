import type {
	WindowBounds,
	WindowStateFactory,
	WindowStateManagedWindow,
} from '../../utils/window/windowStateTypes';

const makeEphemeralWindowStateFactory = (): WindowStateFactory => ({
	create: options => {
		let bounds: WindowBounds = {
			x: undefined,
			y: undefined,
			width: options.defaultWidth,
			height: options.defaultHeight,
		};
		let window: WindowStateManagedWindow|undefined;

		const update = () => {
			if (
				!window ||
				window.isMaximized() ||
				window.isMinimized() ||
				window.isFullScreen()
			) {
				return;
			}
			bounds = window.getBounds();
		};
		const closed = () => {
			if (!window) return;
			window.removeListener('resize', update);
			window.removeListener('move', update);
			window.removeListener('close', update);
			window.removeListener('closed', closed);
			window = undefined;
		};

		return {
			get x() {
				return bounds.x;
			},
			get y() {
				return bounds.y;
			},
			get width() {
				return bounds.width;
			},
			get height() {
				return bounds.height;
			},
			manage: managedWindow => {
				if (window) throw new Error('Ephemeral window state is already managed');
				window = managedWindow;
				window.on('resize', update);
				window.on('move', update);
				window.on('close', update);
				window.on('closed', closed);
			},
		};
	},
});

export default makeEphemeralWindowStateFactory;
