import {
	confirmExplicitPlaintextEgress,
	ExplicitPlaintextEgressKind,
} from './explicitPlaintextEgress';

describe('explicit plaintext egress', () => {
	test('requires an affirmative warning response before export', () => {
		const showWarning = jest.fn(() => 1);

		expect(confirmExplicitPlaintextEgress(ExplicitPlaintextEgressKind.Export, showWarning)).toBe(false);
		expect(showWarning).toHaveBeenCalledWith(
			expect.stringContaining('not encrypted by Watchtower One'),
			expect.objectContaining({
				buttons: ['Continue', 'Cancel'],
				cancelId: 1,
				defaultId: 1,
			}),
		);
	});

	test('continues only for the explicit confirmation button', () => {
		expect(confirmExplicitPlaintextEgress(
			ExplicitPlaintextEgressKind.Print,
			() => 0,
		)).toBe(true);
	});
});
