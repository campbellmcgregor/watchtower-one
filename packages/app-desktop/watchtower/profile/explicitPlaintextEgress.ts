export enum ExplicitPlaintextEgressKind {
	Export = 'export',
	Print = 'print',
}

interface WarningOptions {
	buttons: string[];
	cancelId: number;
	defaultId: number;
	type: 'warning';
}

type ShowWarning = (message: string, options: WarningOptions)=> number;

const actionLabel = (kind: ExplicitPlaintextEgressKind) => kind === ExplicitPlaintextEgressKind.Print ? 'Printing' : 'Exporting';

export const confirmExplicitPlaintextEgress = (
	kind: ExplicitPlaintextEgressKind,
	showWarning: ShowWarning,
) => {
	const response = showWarning(
		`${actionLabel(kind)} creates a plaintext copy outside the Watchtower One vault. ` +
		'The destination and any copies made by other applications are not encrypted by Watchtower One. Continue?',
		{
			type: 'warning',
			buttons: ['Continue', 'Cancel'],
			defaultId: 1,
			cancelId: 1,
		},
	);

	return response === 0;
};
