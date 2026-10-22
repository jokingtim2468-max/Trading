import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTradovate } from '../../server/tradovate.js';

test('Tradovate: login, front-month contract, bracket open, close', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const path = url.replace(/^https:\/\/demo\.tradovateapi\.com\/v1/, '');
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path, body, auth: init.headers.authorization });
    const out = path === '/auth/accesstokenrequest' ? { accessToken: 'tok', expirationTime: new Date(Date.now() + 3600e3).toISOString() }
      : path === '/account/list' ? [{ id: 7, name: 'LUCID123' }, { id: 8, name: 'OTHER' }]
        : path.startsWith('/contract/suggest') ? [{ id: 99, name: 'NQZ6' }]
          : path === '/order/placeOSO' || path === '/order/placeorder' ? { orderId: 501 }
            : path === '/order/liquidateposition' ? { orderId: 502 } : {};
    return new Response(JSON.stringify(out));
  };
  const tv = createTradovate({ creds: () => ({ name: 'u', password: 'p', cid: '12', sec: 's' }), fetchImpl });
  const a = { id: 'A', label: 'Lucid 1', login: 'LUCID123', environment: 'demo' };
  const open = await tv.order(a, 'open', { symbol: 'NQ', side: 'long', qty: 2, sl: 20000, tp: 20100 });
  assert.deepEqual(open, { order_id: 501, contract: 'NQZ6' });
  const oso = calls.find((c) => c.path === '/order/placeOSO');
  assert.equal(oso.auth, 'Bearer tok');
  assert.deepEqual(oso.body, { accountSpec: 'LUCID123', accountId: 7, symbol: 'NQZ6', isAutomated: true, action: 'Buy', orderQty: 2, orderType: 'Market',
    bracket1: { action: 'Sell', orderType: 'Stop', stopPrice: 20000 }, bracket2: { action: 'Sell', orderType: 'Limit', price: 20100 } });
  assert.equal((await tv.order(a, 'close', { symbol: 'NQ', side: 'long', qty: 2 })).order_id, 502);
  assert.deepEqual(calls.find((c) => c.path === '/order/liquidateposition').body, { accountId: 7, contractId: 99, admin: false });
  assert.equal(calls.filter((c) => c.path === '/auth/accesstokenrequest').length, 1, 'the token is reused');
  assert.ok((await tv.order(a, 'modify', { symbol: 'NQ', side: 'long' })).skipped);
  await assert.rejects(createTradovate({ creds: () => null, fetchImpl }).order(a, 'open', { symbol: 'NQ', side: 'long' }), /No Tradovate login/);
});
