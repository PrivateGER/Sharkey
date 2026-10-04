import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// happy-dom has neither OffscreenCanvas nor WebGL. This fake follows the browser contract that matters here:
// once a canvas's WebGL context is lost it stays lost, and a new canvas gets a fresh context.
class FakeOffscreenCanvas extends EventTarget {
	static instances: FakeOffscreenCanvas[] = [];
	static contextsAvailable = true;
	contextLost = !FakeOffscreenCanvas.contextsAvailable;

	constructor(public width: number, public height: number) {
		super();
		FakeOffscreenCanvas.instances.push(this);
	}

	loseContext() {
		this.contextLost = true;
		this.dispatchEvent(new Event('contextlost'));
	}

	transferToImageBitmap() {
		if (this.contextLost) {
			throw new DOMException('Cannot transfer to ImageBitmap because WebGL context is lost.', 'InvalidStateError');
		}
		return { fromCanvas: this };
	}
}

vi.mock('buraha', () => ({
	render: (_hash: string, canvas: FakeOffscreenCanvas) => {
		// buraha draws through canvas.getContext('webgl2'), which returns null when no context can be created.
		if (canvas.contextLost) throw new TypeError('can\'t access property "createShader", e is null');
	},
}));

const HASH = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj';

type Posted = { id: string };

// The worker assigns its handler to the global `onmessage`, which happy-dom does not define on globalThis.
const workerScope = globalThis as unknown as { onmessage: ((ev: MessageEvent) => void) | null };

describe('draw-blurhash worker', () => {
	let posted: Posted[];

	async function startWorker() {
		// The worker sets itself up when its module is evaluated, so each test needs a fresh evaluation.
		await import('@/workers/draw-blurhash.js');
	}

	function send(id: string) {
		workerScope.onmessage?.(new MessageEvent('message', { data: { id, hash: HASH } }));
	}

	beforeEach(() => {
		vi.resetModules();
		FakeOffscreenCanvas.instances = [];
		FakeOffscreenCanvas.contextsAvailable = true;
		posted = [];
		vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
		vi.stubGlobal('postMessage', (msg: Posted) => posted.push(msg));
		vi.stubGlobal('onmessage', null);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	test('keeps drawing after the WebGL context is lost', async () => {
		await startWorker();
		send('before');
		FakeOffscreenCanvas.instances.forEach(c => c.loseContext());
		send('after');
		send('later');

		expect(posted.map(m => m.id)).toEqual(['before', 'after', 'later']);
	});

	test('posts nothing, without throwing, when no WebGL context can be created', async () => {
		FakeOffscreenCanvas.contextsAvailable = false;
		await startWorker();

		expect(() => send('a')).not.toThrow();
		expect(posted).toEqual([]);
	});
});
