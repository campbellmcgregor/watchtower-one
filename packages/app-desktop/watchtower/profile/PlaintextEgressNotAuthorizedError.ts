export default class PlaintextEgressNotAuthorizedError extends Error {

	public readonly code = 'explicitPlaintextEgressRequired';

	public constructor() {
		super('Explicit Plaintext Egress authorization is required');
		this.name = 'PlaintextEgressNotAuthorizedError';
	}
}
