// Tradovate accounts traded straight from QuantBot's chart (Lucid and other futures prop firms give Tradovate
// accounts). Uses Tradovate's REST API with the trader's own API key (Tradovate: Application Settings > API Access).
// Opens are market orders with a bracket (OSO: stop + target) when the trade has them; closes liquidate the position.
// Credentials are kept encrypted in the app's key store, one entry per account.
const BASE = { demo: 'https://demo.tradovateapi.com/v1', live: 'https://live.tradovateapi.com/v1' };

export function createTradovate({ creds, log = () => {}, fetchImpl = fetch }) {
  const sessions = new Map(); // account id -> { token, expires, accountId, accountSpec }
  const contracts = new Map(); // `${env}|${root}` -> { name, id, at }

  const base = (a) => BASE[a.environment === 'live' ? 'live' : 'demo'];
  async function call(a, path, body, token) {
    const res = await fetchImpl(`${base(a)}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.errorText || j.failureReason) throw new Error(`Tradovate ${path}: ${j.errorText || j.failureText || j.failureReason || res.status}`);
    return j;
  }

  async function session(a) {
    const s = sessions.get(a.id);
    if (s && s.expires > Date.now() + 60000) return s;
    const c = creds(a.id);
    if (!c?.name || !c?.password) throw new Error('No Tradovate login saved for this account (Copy trading > the account > Tradovate)');
    const auth = await call(a, '/auth/accesstokenrequest', {
      name: c.name, password: c.password, appId: c.appId || 'QuantBot', appVersion: '1.0', cid: Number(c.cid) || undefined, sec: c.sec || undefined, deviceId: `quantbot-${a.id}`,
    });
    if (!auth.accessToken) throw new Error(`Tradovate login failed${auth['p-ticket'] ? ': too many attempts, wait and retry' : ''}`);
    const list = await call(a, '/account/list', null, auth.accessToken);
    const acct = list.find((x) => x.name === a.login) || list[0];
    if (!acct) throw new Error('No Tradovate account on this login');
    const out = { token: auth.accessToken, expires: Date.parse(auth.expirationTime) || Date.now() + 80 * 60000, accountId: acct.id, accountSpec: acct.name };
    sessions.set(a.id, out);
    return out;
  }

  // App symbol -> the front-month contract (NQ -> NQZ6), unless the account maps it to a contract already
  async function contract(a, s, symbol) {
    const root = String(symbol).replace(/\d.*$/, '');
    if (/\d$/.test(symbol)) return { name: symbol, id: (await call(a, `/contract/find?name=${encodeURIComponent(symbol)}`, null, s.token)).id };
    const key = `${a.environment}|${root}`, hit = contracts.get(key);
    if (hit && Date.now() - hit.at < 6 * 3600000) return hit;
    const found = await call(a, `/contract/suggest?t=${encodeURIComponent(root)}&l=5`, null, s.token);
    const c = (found || []).find((x) => String(x.name).startsWith(root));
    if (!c) throw new Error(`No Tradovate contract for ${symbol}`);
    const out = { name: c.name, id: c.id, at: Date.now() };
    contracts.set(key, out);
    return out;
  }

  // action: open | close | close_part | modify (modify isn't sent: move the bracket in Tradovate for now)
  async function order(a, action, trade) {
    const s = await session(a);
    const symbol = (a.symbol_map && a.symbol_map[trade.symbol]) || trade.symbol;
    const c = await contract(a, s, symbol);
    const buy = trade.side === 'long';
    const base = { accountSpec: s.accountSpec, accountId: s.accountId, symbol: c.name, isAutomated: true };
    if (action === 'open') {
      const qty = Math.max(1, Math.round(Number(trade.qty) || 1));
      const main = { ...base, action: buy ? 'Buy' : 'Sell', orderQty: qty, orderType: 'Market' };
      const exit = buy ? 'Sell' : 'Buy';
      const brackets = {
        ...(trade.sl != null ? { bracket1: { action: exit, orderType: 'Stop', stopPrice: Number(trade.sl) } } : {}),
        ...(trade.tp != null ? { [trade.sl != null ? 'bracket2' : 'bracket1']: { action: exit, orderType: 'Limit', price: Number(trade.tp) } } : {}),
      };
      const r = Object.keys(brackets).length ? await call(a, '/order/placeOSO', { ...main, ...brackets }, s.token) : await call(a, '/order/placeorder', main, s.token);
      log(`tradovate ${a.label}: ${main.action} ${qty} ${c.name} (order ${r.orderId})`);
      return { order_id: r.orderId, contract: c.name };
    }
    if (action === 'close' || action === 'close_part') {
      if (action === 'close_part') {
        const qty = Math.max(1, Math.round(Number(trade.qty) || 1));
        const r = await call(a, '/order/placeorder', { ...base, action: buy ? 'Sell' : 'Buy', orderQty: qty, orderType: 'Market' }, s.token);
        return { order_id: r.orderId, contract: c.name };
      }
      const r = await call(a, '/order/liquidateposition', { accountId: s.accountId, contractId: c.id, admin: false }, s.token);
      log(`tradovate ${a.label}: closed ${c.name}`);
      return { order_id: r.orderId, contract: c.name };
    }
    return { skipped: 'Stop / target moves are not sent to Tradovate yet: move them in Tradovate' };
  }

  // Login check for the account dialog's Test button -> { ok, account }
  async function test(a) {
    sessions.delete(a.id);
    const s = await session(a);
    return { ok: true, account: s.accountSpec };
  }

  // Log every Tradovate account with trading on in at startup (and every 30 min), so the first order is instant and
  // a wrong login shows up before it matters -> status per account id
  const status = new Map();
  async function connectAll(list) {
    const accounts = await list;
    for (const a of accounts.filter((x) => x.platform === 'Tradovate' && x.tradovate_on)) {
      try { await session(a); status.set(a.id, { ok: true, at: Date.now() }); } catch (e) { status.set(a.id, { ok: false, error: e.message, at: Date.now() }); log(`tradovate ${a.label}: ${e.message}`); }
    }
  }

  return { order, test, connectAll, status: (id) => status.get(id) || null };
}
