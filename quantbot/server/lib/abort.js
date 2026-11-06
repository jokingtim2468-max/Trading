// Stop button: a chat reply runs inside withSignal(signal, fn); every model request made inside it (Ollama, Claude,
// Gemini) picks the signal up with stopSignal(), so pressing Stop cancels the request that is running right now.
import { AsyncLocalStorage } from 'node:async_hooks';

const store = new AsyncLocalStorage();
export const withSignal = (signal, fn) => store.run(signal, fn);
export const stopSignal = () => store.getStore() || null;
// The request's own timeout plus the Stop signal, when there is one
export const withStop = (timeoutMs) => {
  const s = stopSignal();
  const t = AbortSignal.timeout(timeoutMs);
  return s ? AbortSignal.any([t, s]) : t;
};
export const STOPPED = 'Stopped';
export const isStop = (e) => e?.name === 'AbortError' || e?.message === STOPPED || stopSignal()?.aborted === true;
