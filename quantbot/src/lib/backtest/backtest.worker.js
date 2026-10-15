import { runBacktest } from './engine';

self.onmessage = (e) => {
  try {
    const result = runBacktest(e.data, (done, total) => self.postMessage({ progress: { done, total } }));
    self.postMessage({ ok: true, result });
  } catch (err) {
    self.postMessage({ ok: false, error: err.message });
  }
};
