import { EventEmitter } from 'events';
import makeEphemeralWindowStateFactory from './EphemeralWindowState';
import type {
	WindowStateManagedWindow,
} from '../../utils/window/windowStateTypes';

class TestWindow extends EventEmitter implements WindowStateManagedWindow {

	public bounds = { x: 40, y: 50, width: 900, height: 700 };
	public maximized = false;
	public minimized = false;
	public fullScreen = false;

	public getBounds() {
		return this.bounds;
	}

	public isMaximized() {
		return this.maximized;
	}

	public isMinimized() {
		return this.minimized;
	}

	public isFullScreen() {
		return this.fullScreen;
	}

	public maximize() {
		this.maximized = true;
	}

	public setFullScreen(value: boolean) {
		this.fullScreen = value;
	}
}

describe('EphemeralWindowState', () => {
	test('window usage metadata remains inside one application session', () => {
		const factory = makeEphemeralWindowStateFactory();
		const state = factory.create({
			defaultWidth: 800,
			defaultHeight: 600,
		});
		const window = new TestWindow();
		state.manage(window);

		window.bounds = { x: 100, y: 120, width: 1100, height: 760 };
		window.emit('move');
		window.emit('resize');

		expect({
			x: state.x,
			y: state.y,
			width: state.width,
			height: state.height,
		}).toEqual({
			x: 100,
			y: 120,
			width: 1100,
			height: 760,
		});

		const nextSession = makeEphemeralWindowStateFactory().create({
			defaultWidth: 800,
			defaultHeight: 600,
		});
		expect({
			x: nextSession.x,
			y: nextSession.y,
			width: nextSession.width,
			height: nextSession.height,
		}).toEqual({
			x: undefined,
			y: undefined,
			width: 800,
			height: 600,
		});
	});
});
