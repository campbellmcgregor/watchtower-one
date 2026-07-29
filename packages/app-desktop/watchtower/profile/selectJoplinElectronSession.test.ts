import type { Session } from 'electron';
import {
	bindSuppliedSessionToWindow,
	default as selectJoplinElectronSession,
} from './selectJoplinElectronSession';

describe('selectJoplinElectronSession', () => {
	test('uses the supplied ephemeral session without creating stock profile state', () => {
		const suppliedSession = {} as Session;
		const createStockSession = jest.fn(() => ({} as Session));

		expect(selectJoplinElectronSession(
			suppliedSession,
			createStockSession,
		)).toBe(suppliedSession);
		expect(createStockSession).not.toHaveBeenCalled();
	});

	test('preserves stock Joplin session creation when no session is supplied', () => {
		const stockSession = {} as Session;
		const createStockSession = jest.fn(() => stockSession);

		expect(selectJoplinElectronSession(
			undefined,
			createStockSession,
		)).toBe(stockSession);
		expect(createStockSession).toHaveBeenCalledTimes(1);
	});

	test('binds secondary content windows only when Watchtower supplied a session', () => {
		const suppliedSession = {} as Session;
		const options = {
			show: false,
			webPreferences: {
				nodeIntegration: true,
			},
		};

		expect(bindSuppliedSessionToWindow(options, suppliedSession)).toEqual({
			show: false,
			webPreferences: {
				nodeIntegration: true,
				session: suppliedSession,
			},
		});
		expect(bindSuppliedSessionToWindow(options, undefined)).toBe(options);
		expect(() => bindSuppliedSessionToWindow({
			webPreferences: {
				session: {} as Session,
			},
		}, suppliedSession)).toThrow(
			'Content-bearing window requested a different Electron session',
		);
	});
});
