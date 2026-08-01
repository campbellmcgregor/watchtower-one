export interface RendererProfileCloseReply {
	canClose: boolean;
}

export type RendererProfileCloseOutcome = 'ready'|'timeout';

interface PendingClose {
	resolve: (outcome: RendererProfileCloseOutcome)=> void;
	timeout: ReturnType<typeof setTimeout>;
}

export default class RendererProfileCloseCoordinator {

	private pending_: PendingClose|undefined;

	public constructor(private readonly timeoutMilliseconds_: number) {}

	public request(sendCloseRequest: ()=> void): Promise<RendererProfileCloseOutcome> {
		if (this.pending_) throw new Error('Renderer profile close is already pending');
		return new Promise(resolve => {
			const timeout = setTimeout(() => {
				this.pending_ = undefined;
				resolve('timeout');
			}, this.timeoutMilliseconds_);
			this.pending_ = { resolve, timeout };
			sendCloseRequest();
		});
	}

	public accept(reply: RendererProfileCloseReply): boolean {
		const pending = this.pending_;
		if (!pending) return false;
		if (!reply.canClose) return true;
		clearTimeout(pending.timeout);
		this.pending_ = undefined;
		pending.resolve('ready');
		return true;
	}
}
