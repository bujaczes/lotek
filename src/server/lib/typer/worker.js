import { parentPort, workerData } from 'node:worker_threads';
import { enumerateTopK } from './enumerate.js';

// Worker-thread entry for the full C(49,6) enumeration. The engine (main thread) reads
// the DB, computes the per-number weight/bias arrays and the historical winner masks, and
// hands them here as plain structured-clonable data; this thread does the ~14M-combo
// scoring so the event loop never blocks. Pure compute, no DB, no I/O — same inputs give
// a bit-identical result on either thread (identical IEEE-754 ops in a fixed order).
if (!parentPort) {
  throw new Error('typer/worker.js must be run as a worker_thread, not directly');
}

const result = enumerateTopK(workerData);
parentPort.postMessage(result);
