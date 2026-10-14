// Runs the simulation off the main thread so a stuck strategy can't freeze the app.
export function runInWorker(payload, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./backtest.worker.js', import.meta.url), { type: 'module' });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error(`Simulation took longer than ${timeoutMs / 1000}s and was stopped (possible infinite loop).`));
    }, timeoutMs);
    worker.onmessage = (e) => {
      clearTimeout(timer);
      worker.terminate();
      if (e.data.ok) resolve(e.data.result);
      else reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      clearTimeout(timer);
      worker.terminate();
      reject(new Error(e.message || 'Simulation crashed'));
    };
    worker.postMessage(payload);
  });
}