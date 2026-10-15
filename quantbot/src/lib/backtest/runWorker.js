// Runs the simulation off the main thread so a slow or stuck strategy can't freeze the app.
// The worker reports progress every 1000 bars, which tells three cases apart:
// - stuck: no progress for STALL_MS (an endless loop inside one bar)
// - too slow: the run is on course to take longer than maxMs (usually code that re-scans the whole chart every bar)
// - fine: everything else, however many bars there are
// Both failures reject with an Error whose .slow = { done, total, seconds, stuck } so callers can ask for faster code.
// signal: an AbortSignal that stops the simulation at once (the Stop buttons)
// onProgress(done, total): bars simulated so far
const STALL_MS = 20000;
const GRACE_MS = 8000;

export function runInWorker(payload, { maxMs = 120000, signal = null, onProgress = null } = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./backtest.worker.js', import.meta.url), { type: 'module' });
    const t0 = Date.now();
    let done = 0, total = 0, last = t0, timer = null, perBar = 0;
    const finish = (fn, value) => { clearInterval(timer); worker.terminate(); fn(value); };
    const slow = (stuck) => {
      const seconds = Math.round((Date.now() - t0) / 1000);
      const pct = total ? Math.floor((done / total) * 100) : 0;
      const err = new Error(stuck
        ? `Simulation stopped: one bar took more than ${STALL_MS / 1000}s after ${done} of ${total} bars (the test code is stuck in a loop).`
        : `Simulation was too slow: ${pct}% of ${total.toLocaleString()} bars in ${seconds}s. The test code re-scans too much history on every bar.`);
      err.slow = { done, total, seconds, stuck };
      finish(reject, err);
    };
    if (signal?.aborted) return finish(reject, new DOMException('Stopped', 'AbortError'));
    signal?.addEventListener('abort', () => finish(reject, new DOMException('Stopped', 'AbortError')), { once: true });
    timer = setInterval(() => {
      const now = Date.now(), elapsed = now - t0;
      if (now - last > STALL_MS) return slow(true);
      if (elapsed > maxMs) return slow(false);
      // On course to run past the limit, at the speed of the latest stretch (code that slows down as history grows
      // only gets slower after that)
      if (elapsed > GRACE_MS && perBar > 0 && elapsed + (total - done) * perBar > maxMs) slow(false);
    }, 500);
    worker.onmessage = (e) => {
      if (e.data.progress) {
        const now = Date.now();
        if (e.data.progress.done > done) perBar = (now - last) / (e.data.progress.done - done);
        ({ done, total } = e.data.progress);
        last = now;
        onProgress?.(done, total);
        return;
      }
      if (e.data.ok) finish(resolve, e.data.result);
      else finish(reject, new Error(e.data.error));
    };
    worker.onerror = (e) => finish(reject, new Error(e.message || 'Simulation crashed'));
    worker.postMessage(payload);
  });
}
