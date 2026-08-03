import Setting from '@joplin/lib/models/Setting';
import { runtime } from './revealResourceFile';

describe('revealResourceFile encrypted-profile policy', () => {
	test('rejects before loading or revealing a resource', async () => {
		Setting.setConstant('allowExternalEditing', false);
		try {
			await expect(runtime().execute({} as never, 'resource-id')).rejects.toThrow(
				'External editing is unavailable for encrypted profiles',
			);
			expect(runtime().enabledCondition).toBe('false');
			expect(runtime().visibleCondition).toBe('false');
		} finally {
			Setting.setConstant('allowExternalEditing', true);
		}
	});
});
