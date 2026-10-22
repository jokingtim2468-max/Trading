import { useState } from 'react';
import { X } from 'lucide-react';
import { usdSigned } from '@/lib/tradeMath';

const f2 = (n) => (n == null || !Number.isFinite(Number(n)) ? '–' : Number(n).toFixed(2));
const NAME = { buy_limit: 'Buy limit', buy_stop: 'Buy stop', sell_limit: 'Sell limit', sell_stop: 'Sell stop' };
const COLS = 'grid grid-cols-[1.3fr_.9fr_.7fr_.6fr_.9fr_.9fr_.9fr_.6fr] items-center px-3.5';

// Under the chart: open positions, pending orders and price alerts (in replay: the practice trades)
export default function BottomPanel({ positions, pending, alerts, practice, replay, group, onClose, onCancel, onRemoveAlert, onCloseAll, editor, room = null }) {
  const [tab, setTab] = useState('positions');
  const tabs = [...(replay ? [['practice', `Practice ${practice.open.length}`]] : [['positions', `Positions ${positions.length}`], ['orders', `Orders ${pending.length}`], ['alerts', `Alerts ${alerts.length}`]]), ['editor', 'Pine Editor']];
  const cur = tabs.some(([id]) => id === tab) ? tab : tabs[0][0];
  return (
    <div className={`${cur === 'editor' ? 'h-[300px]' : 'h-[190px]'} shrink-0 border-t border-[#2a2e39] flex flex-col`} data-testid="terminal-positions">
      <div className="flex items-center gap-5 px-3.5 pt-2 border-b border-[#2a2e39]">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" onClick={() => setTab(id)} data-testid={`tab-${id}`}
            className={`pb-1.5 border-b-2 transition-colors ${cur === id ? 'font-semibold text-white border-[#2962ff]' : 'text-[#787b86] border-transparent hover:text-[#d1d4dc]'}`}>{label}</button>
        ))}
        <span className="ml-auto pb-1.5 text-[11px] text-[#5d606b]">Charts by <a className="hover:text-[#787b86]" href="https://www.tradingview.com/lightweight-charts/" target="_blank" rel="noreferrer">TradingView Lightweight Charts™</a></span>
        {cur === 'positions' && <button type="button" disabled={!positions.some((t) => t.closable)} onClick={onCloseAll} className="mb-1.5 px-2.5 py-0.5 rounded-md border border-[#f23645]/40 text-[#f23645] disabled:opacity-40">Close all</button>}
        {cur === 'practice' && <span className="pb-1.5 tabular-nums">Practice P&L <b className={practice.pnl >= 0 ? 'text-[#089981]' : 'text-[#f23645]'} data-testid="practice-pnl">{usdSigned(practice.pnl)}</b>{practice.closed.length ? ` · ${practice.closed.length} closed, ${Math.round((practice.closed.filter((t) => t.pnl > 0).length / practice.closed.length) * 100)}% won` : ''}</span>}
      </div>
      {cur === 'editor' && <div className="flex-1 min-h-0">{editor}</div>}
      <div className={`overflow-y-auto ${cur === 'editor' ? 'hidden' : ''}`}>
        {(cur === 'positions' || cur === 'practice') && (
          <>
            <div className={`${COLS} py-1.5 text-xs text-[#787b86]`}><span>{cur === 'practice' ? 'Trade' : 'Account'}</span><span>Symbol</span><span>Side</span><span>Size</span><span>Entry</span><span>Stop</span><span>Target</span><span /></div>
            {cur === 'positions' && !positions.length && (
              <div className="px-3.5 py-3 text-[#787b86]">
                Flat{group ? ` on ${group.name}` : ''}{room ? <>, with <span className="qb-num text-[#d1d4dc]">${Math.round(room.left).toLocaleString('en-US')}</span> of today&apos;s room left on {room.name}</> : ''}. Trade with Buy / Sell on the chart, the ticket on the right, or the + next to the price axis.
              </div>
            )}
            {cur === 'practice' && !practice.open.length && <div className="px-3.5 py-3 text-[#5d606b]">Place a practice trade with the ticket, then step the replay forward.</div>}
            {(cur === 'practice' ? practice.open : positions).map((t) => (
              <div key={t.id || t.key} className={`${COLS} py-1.5 border-t border-[#1e222d]`}>
                <span className="truncate">{t.account || 'Practice'}</span><span>{t.symbol}</span>
                <span className={t.side === 'long' ? 'text-[#2962ff]' : 'text-[#f23645]'}>{t.side === 'long' ? 'Buy' : 'Sell'}</span>
                <span className="tabular-nums">{t.qty}</span><span className="tabular-nums">{f2(t.entry)}</span><span className="tabular-nums">{f2(t.sl)}</span><span className="tabular-nums">{f2(t.tp)}</span>
                <button type="button" disabled={!t.closable} title={t.closable ? '' : 'Opened by a script: it closes when the script says so'} onClick={() => onClose(t)} className="h-6 rounded-md border border-[#363a45] hover:bg-[#2a2e39] disabled:opacity-40">Close</button>
              </div>
            ))}
          </>
        )}
        {cur === 'orders' && (
          <>
            {!pending.length && <div className="px-3.5 py-3 text-[#5d606b]">No pending orders. Pick Limit or Stop on the ticket, or right-click the chart at a price.</div>}
            {pending.map((p) => (
              <div key={p.id} className="flex items-center gap-4 px-3.5 py-1.5 border-t border-[#1e222d]" data-testid="order-row">
                <span className={p.event.startsWith('buy') ? 'text-[#2962ff]' : 'text-[#f23645]'}>{NAME[p.event]}</span>
                <span>{p.symbol}</span><span className="tabular-nums">at {f2(p.at)}</span>
                <span className="text-[#787b86] tabular-nums">{p.risk_usd ? `$${p.risk_usd} risk` : `${p.qty} lots`}{p.sl != null ? ` · SL ${f2(p.sl)}` : ''}{p.tp != null ? ` · TP ${f2(p.tp)}` : ''}</span>
                <button type="button" onClick={() => onCancel(p)} className="ml-auto h-6 px-2.5 rounded-md border border-[#363a45] hover:bg-[#2a2e39]">Cancel</button>
              </div>
            ))}
          </>
        )}
        {cur === 'alerts' && (
          <>
            {!alerts.length && <div className="px-3.5 py-3 text-[#5d606b]">No price alerts. Right-click the chart at a price and pick “Alert at …”.</div>}
            {alerts.map((a) => (
              <div key={a.id} className="flex items-center gap-4 px-3.5 py-1.5 border-t border-[#1e222d]" data-testid="alert-row">
                <span>{a.symbol}</span><span className="tabular-nums">{a.above ? 'rises to' : 'falls to'} {f2(a.price)}</span>
                <button type="button" aria-label="Remove this alert" onClick={() => onRemoveAlert(a)} className="ml-auto w-6 h-6 rounded-md flex items-center justify-center hover:bg-[#2a2e39]"><X className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
