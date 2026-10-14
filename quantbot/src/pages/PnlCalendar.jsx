import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { client } from '@/api/client';
import usePnlData from '@/hooks/usePnlData';
import { keyLabel } from '@/lib/pnl';
import PnlToolbar from '@/components/pnl/PnlToolbar';
import PnlSummary from '@/components/pnl/PnlSummary';
import DayCalendar from '@/components/pnl/DayCalendar';
import PeriodGrid from '@/components/pnl/PeriodGrid';
import PnlBars from '@/components/pnl/PnlBars';
import PeriodTrades from '@/components/pnl/PeriodTrades';
import ChartLoader from '@/components/quant/ChartLoader';

const VIEW_OF = { exit_day: 'day', exit_week: 'week', exit_month: 'month' };

export default function PnlCalendar() {
  const [view, setView] = useState('day');
  const [anchor, setAnchor] = useState(null);
  const [bot, setBot] = useState('all');
  const [bots, setBots] = useState([]);
  const [selected, setSelected] = useState(null);
  const data = usePnlData(view, anchor, bot === 'all' ? null : bot);

  useEffect(() => {
    const { Trade } = client.entities;
    Trade.filter({}, { distinct: 'bot_name' }).then((p) => setBots(p.items));
    // Open on the month of the most recent trade
    Trade.filter({}, { sort: '-exit_time', limit: 1, fields: ['exit_day'] }).then((p) => {
      const d = p.items[0]?.exit_day || new Date().toISOString().slice(0, 10);
      setAnchor({ y: +d.slice(0, 4), m: +d.slice(5, 7) - 1 });
    });
  }, []);
  useEffect(() => { setSelected(null); }, [view, anchor, bot]);

  const max = Math.max(0, ...[...data.rows.values()].map((c) => Math.abs(c.pnl)));
  const select = (field, value) => setSelected({ field, value });
  const grid = { anchor, rows: data.rows, max, selected: selected?.value, onSelect: select };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 h-14 glass-bar flex items-center gap-3 px-4">
        <Link to="/" className="p-2 rounded-md hover:bg-accent"><ArrowLeft className="w-4 h-4" /></Link>
        <h1 className="font-heading text-lg font-semibold">PnL calendar</h1>
        <span className="text-xs text-muted-foreground ml-2 hidden sm:inline">Closed trades from your saved strategy tests (UTC days)</span>
      </header>
      {!anchor ? <div className="flex justify-center py-20"><ChartLoader className="w-20 h-12" /></div> : (
        <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-5">
          <PnlToolbar view={view} onView={setView} anchor={anchor} onAnchor={setAnchor} bots={bots} bot={bot} onBot={setBot} />
          <PnlSummary rows={data.rows} wins={data.wins} view={view} />
          <div className={data.loading ? 'opacity-50 pointer-events-none' : ''}>
            {view === 'day' ? <DayCalendar {...grid} /> : <PeriodGrid view={view} {...grid} />}
          </div>
          {!data.loading && !data.rows.size && <p className="text-sm text-muted-foreground">No closed trades in this period. Try another period, or <Link to="/strategy-tester" className="text-primary underline">run a test</Link>.</p>}
          <PnlBars rows={data.rows} view={view} />
          {selected && <PeriodTrades field={selected.field} value={selected.value} label={keyLabel(VIEW_OF[selected.field], selected.value)} bot={bot === 'all' ? null : bot} />}
        </div>
      )}
    </div>
  );
}