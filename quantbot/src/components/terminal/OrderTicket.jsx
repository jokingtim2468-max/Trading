import { ShieldCheck, ShieldOff } from 'lucide-react';

const f2 = (n) => (Number.isFinite(n) ? n.toFixed(2) : '–');
const money = (v) => (v == null ? 'no limit' : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const TYPES = [['market', 'Market'], ['limit', 'Limit'], ['stop', 'Stop']];
// What each order type does, in one line under the switch
export const TYPE_HELP = {
  market: 'Fills now at the current price.',
  limit: 'Waits for a better price: a buy limit sits below the price, a sell limit above. It fills when the price comes back to it.',
  stop: 'Waits for a breakout: a buy stop sits above the price, a sell stop below. It fills when the price pushes through it.',
};

export const Row = ({ k, v, tone }) => (
  <div className="flex items-center justify-between gap-2"><span className="text-[#787b86] shrink-0">{k}</span>
    <span className={`tabular-nums truncate ${tone === 'loss' ? 'text-[#f23645]' : tone === 'profit' ? 'text-[#089981]' : tone === 'warn' ? 'text-[#ff9800]' : 'text-[#d1d4dc]'}`}>{v}</span></div>
);

// A number field with - / + buttons
export function Stepper({ label, value, onChange, step, min, base = 0, placeholder, hint, hintTone, testid }) {
  const bump = (d) => { const v = value === '' ? Number(base) || 0 : Number(value) || 0; onChange(String(Math.max(min ?? -Infinity, Math.round((v + d) * 100) / 100))); };
  return (
    <label className="block space-y-1">
      <span className="flex items-center justify-between text-xs text-[#787b86]">{label}
        {hint && <span className={`tabular-nums ${hintTone === 'loss' ? 'text-[#f23645]' : hintTone === 'muted' ? 'text-[#9598a1]' : 'text-[#089981]'}`}>{hint}</span>}</span>
      <span className="flex h-9 rounded-lg bg-[#1e222d] border border-[#2a2e39] focus-within:border-[#2962ff] overflow-hidden">
        <button type="button" aria-label={`${label} down`} onClick={() => bump(-step)} className="w-8 text-[#787b86] hover:bg-[#2a2e39] hover:text-white">−</button>
        <input value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" placeholder={placeholder} data-testid={testid} aria-label={label}
          className="flex-1 min-w-0 bg-transparent text-center text-[13px] text-[#d1d4dc] tabular-nums outline-none placeholder:text-[#5d606b]" />
        <button type="button" aria-label={`${label} up`} onClick={() => bump(step)} className="w-8 text-[#787b86] hover:bg-[#2a2e39] hover:text-white">+</button>
      </span>
    </label>
  );
}

const Seg = ({ options, value, onChange, testid }) => (
  <div className="grid gap-1 p-1 rounded-[10px] bg-[#1e222d]" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
    {options.map(([id, label]) => (
      <button key={id} type="button" onClick={() => onChange(id)} data-testid={`${testid}-${id}`}
        className={`h-7 rounded-md text-xs transition-colors ${value === id ? 'bg-[#2a2e39] text-white' : 'text-[#787b86] hover:text-[#d1d4dc]'}`}>{label}</button>
    ))}
  </div>
);

// The order ticket: side, order type, size in lots or dollar risk, stop / target, and the rule guard (each account's
// room before its daily loss limit or max drawdown, and whether this order fits)
export default function OrderTicket({ symbol, last, ticket, setTicket, preview, guardRows, guardOn, setGuardOn, group, activeCount, onPlace, replay, canPlace }) {
  const kind = ticket.type || 'market';
  const at = kind === 'market' ? last : Number(ticket.at);
  const blocked = guardOn && !replay ? guardRows.filter((r) => r.ticket && !r.ticket.ok) : [];
  const lowest = guardRows.filter((r) => r.room != null).sort((a, b) => a.room - b.room)[0];
  const sizes = [...new Set(guardRows.map((r) => r.ticket?.qty).filter((q) => q != null))];
  const sizeText = ticket.sizing === 'risk' ? (sizes.length ? `${sizes.join(' / ')} lots` : '–') : ticket.qty;
  const label = `${ticket.side === 'buy' ? 'Buy' : 'Sell'}${kind === 'market' ? '' : ` ${kind}`} ${sizeText} ${symbol}${kind === 'market' ? '' : ` at ${f2(at)}`}`;
  return (
    <div className="w-[300px] shrink-0 border-l border-[#2a2e39] flex flex-col" data-testid="order-ticket">
      <div className="px-3.5 pt-3.5 pb-3 border-b border-[#2a2e39]">
        <div className="flex items-baseline justify-between">
          <span className="text-white font-semibold">{symbol}</span>
          <span className="text-[11px] text-[#787b86]">{replay ? 'Practice (replay)' : `${kind[0].toUpperCase()}${kind.slice(1)} order`}</span>
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-1 p-1 rounded-[10px] bg-[#1e222d]">
          {[['sell', 'Sell'], ['buy', 'Buy']].map(([side, l]) => (
            <button key={side} type="button" onClick={() => setTicket((t) => ({ ...t, side }))} data-testid={`side-${side}`}
              className={`h-11 rounded-lg flex flex-col items-center justify-center transition-colors ${ticket.side === side ? (side === 'buy' ? 'bg-[#2962ff] text-white' : 'bg-[#f23645] text-white') : 'text-[#787b86] hover:text-[#d1d4dc]'}`}>
              <span className="text-[11px] leading-none">{l}</span>
              <span className="text-[15px] font-semibold tabular-nums leading-tight">{f2(last)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3.5 py-3 flex flex-col gap-3">
        {!replay && (
          <div className="space-y-1.5">
            <Seg options={TYPES} value={kind} onChange={(type) => setTicket((t) => ({ ...t, type, at: type === 'market' ? '' : t.at || (last != null ? String(Math.round((last + (((type === 'limit') === (t.side === 'buy')) ? -2 : 2)) * 100) / 100) : '') }))} testid="type" />
            <p className="text-[11px] leading-snug text-[#787b86]" data-testid="type-help">{TYPE_HELP[kind]}</p>
          </div>
        )}
        {kind !== 'market' && !replay && <Stepper label={`${kind === 'limit' ? 'Limit' : 'Stop'} price`} value={ticket.at} step={1} base={last} onChange={(v) => setTicket((t) => ({ ...t, at: v }))} testid="ticket-at" />}
        <Seg options={[['lots', 'Lots'], ['risk', '$ Risk']]} value={ticket.sizing || 'lots'} onChange={(sizing) => setTicket((t) => ({ ...t, sizing }))} testid="sizing" />
        {ticket.sizing === 'risk'
          ? <Stepper label="Risk per account ($)" value={ticket.risk} step={50} min={0} onChange={(v) => setTicket((t) => ({ ...t, risk: v }))} testid="ticket-risk"
            hint={ticket.sl ? (sizes.length ? `= ${sizes.join(' / ')} lots` : '') : 'needs a stop loss'} hintTone={ticket.sl ? 'muted' : 'loss'} />
          : <Stepper label="Size" value={ticket.qty} step={1} min={0.01} onChange={(v) => setTicket((t) => ({ ...t, qty: v }))} testid="ticket-qty" />}
        <Stepper label="Stop loss" value={ticket.sl} step={1} placeholder="None" base={at} onChange={(v) => setTicket((t) => ({ ...t, sl: v }))} testid="ticket-sl" hint={preview.sl} hintTone="loss" />
        <Stepper label="Take profit" value={ticket.tp} step={1} placeholder="None" base={at} onChange={(v) => setTicket((t) => ({ ...t, tp: v }))} testid="ticket-tp" hint={preview.tp} hintTone="profit" />
        <div className="rounded-[10px] bg-[#1e222d] px-3 py-2.5 text-xs space-y-1.5">
          <Row k="Accounts" v={replay ? 'none (practice)' : `${activeCount} in ${group?.name || '–'}`} />
          <Row k="Risk" v={preview.sl || '–'} tone={preview.sl ? 'loss' : ''} />
          <Row k="Reward" v={preview.tp || '–'} tone={preview.tp ? 'profit' : ''} />
        </div>
        {!replay && (
          <div className="rounded-[10px] border border-[#2a2e39] px-3 py-2.5 text-xs space-y-2" data-testid="guard">
            <button type="button" onClick={() => setGuardOn(!guardOn)} className="w-full flex items-center gap-2 text-left" data-testid="guard-toggle" aria-pressed={guardOn}>
              {guardOn ? <ShieldCheck className="w-4 h-4 text-[#089981]" /> : <ShieldOff className="w-4 h-4 text-[#787b86]" />}
              <span className="font-medium text-[#d1d4dc]">Rule guard</span>
              <span className={`ml-auto relative w-7 h-4 rounded-full transition-colors ${guardOn ? 'bg-[#089981]' : 'bg-[#363a45]'}`}><span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-[left] ${guardOn ? 'left-3.5' : 'left-0.5'}`} /></span>
            </button>
            {!guardRows.length && <p className="text-[#5d606b]">No active accounts in this group.</p>}
            {guardRows.map((r) => (
              <div key={r.id} className={`flex items-center gap-2 ${r.ticket && !r.ticket.ok ? 'text-[#f23645]' : ''}`} data-testid="guard-row">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${r.ticket && !r.ticket.ok ? 'bg-[#f23645]' : r === lowest ? 'bg-[#ff9800]' : 'bg-[#089981]'}`} />
                <span className="truncate">{r.name}</span>
                <span className="ml-auto tabular-nums text-right" title={r.room != null ? `Left before its ${r.rule}` : 'No loss limits set'}>
                  {r.ticket?.risk != null ? `${money(r.ticket.risk)} of ` : ''}{money(r.room)}
                </span>
              </div>
            ))}
            {lowest && <p className="text-[11px] text-[#787b86]" data-testid="guard-lowest">Lowest: <b className="font-medium text-[#ff9800]">{lowest.name}</b>, {money(lowest.room)} before its {lowest.rule}.{(lowest.open?.fail ?? lowest.ticket?.fail) != null ? ` Price fails it at ${f2(lowest.open?.fail ?? lowest.ticket?.fail)} (the orange line).` : ''}</p>}
          </div>
        )}
      </div>
      <div className="p-3.5 border-t border-[#2a2e39] space-y-2">
        <button type="button" disabled={!canPlace || blocked.length > 0} onClick={onPlace} data-testid="ticket-place"
          className={`w-full h-11 rounded-[10px] text-white font-semibold transition-[filter] hover:brightness-110 disabled:opacity-40 ${ticket.side === 'buy' ? 'bg-[#2962ff]' : 'bg-[#f23645]'}`}>
          {label}
        </button>
        <p className={`text-[11px] text-center ${blocked.length ? 'text-[#f23645]' : 'text-[#5d606b]'}`} data-testid="ticket-note"
          title="Firm rules, news blocks and one trade per account apply; MT5 accounts place it through the QuantBot Copier EA">
          {replay ? 'Practice only: nothing goes to your accounts'
            : blocked.length ? (blocked[0].ticket.risk == null ? 'Rule guard: add a stop loss so the risk can be checked' : `Rule guard: ${blocked[0].name} would risk ${money(blocked[0].ticket.risk)} with ${money(blocked[0].room)} left`)
              : 'Goes to every active account in the group'}
        </p>
      </div>
    </div>
  );
}
