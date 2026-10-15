import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import useSignals from '@/hooks/useSignals';
import { positionsFrom } from '@/lib/signals';
import WebhookCard from '@/components/signals/WebhookCard';
import PositionsCard from '@/components/signals/PositionsCard';
import SignalLog from '@/components/signals/SignalLog';
import ChartLoader from '@/components/quant/ChartLoader';

export default function Signals() {
  const s = useSignals();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 h-14 glass-bar flex items-center gap-3 px-4">
        <Link to="/" className="p-2 rounded-md hover:bg-accent"><ArrowLeft className="w-4 h-4" /></Link>
        <h1 className="font-heading text-lg font-semibold">Signals</h1>
        <span className="text-xs text-muted-foreground ml-2 hidden sm:inline">Live buy, sell, close, SL and TP signals from your TradingView and MT5 scripts</span>
      </header>
      {!s.signals ? <div className="flex justify-center py-20"><ChartLoader className="w-20 h-12" /></div> : (
        <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-4">
          <WebhookCard config={s.config} onTunnel={s.tunnel} onTest={s.test} onRotate={s.rotate} />
          <PositionsCard positions={positionsFrom(s.signals)} />
          <SignalLog signals={s.signals} onClear={s.clear} />
        </div>
      )}
    </div>
  );
}
