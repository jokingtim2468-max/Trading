// When QuantBot was opened from the desktop shortcut, tell the launcher this window is still open. It quits a few
// minutes after the last heartbeat (window closed). Nothing happens with npm start.
const post = (path) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {});

export async function startHeartbeat() {
  try {
    const ping = await (await fetch('/api/app/ping')).json();
    if (!ping.managed) return;
  } catch {
    return;
  }
  const beat = () => post('/api/app/heartbeat');
  beat();
  setInterval(beat, 20000);
  document.addEventListener('visibilitychange', beat);
  window.addEventListener('focus', beat);
}

export const appPost = post;
