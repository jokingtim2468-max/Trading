import { runBacktest } from './engine';

self.onmessage = (e) => {
  try {
    self.postMessage({ ok: true, result: runBacktest(e.data) });
  } catch (err) {
    self.postMessage({ ok: false, error: err.message });
  }
};