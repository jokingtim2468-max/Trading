import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, History, ArrowLeftRight, FlaskConical, Microscope } from 'lucide-react';
import { ConverterPanel } from '@/pages/StrategyConverter';
import { TesterPanel } from '@/pages/StrategyTester';
import { MarketLabPanel } from '@/pages/MarketLab';

// One page for every AI strategy tool, in the order you use them: turn an idea into a bot (Convert), test a script
// from a chat (Test), and read a market's quant profile (Market). Each tab keeps its own URL (/strategy-converter,
// /strategy-tester, /market-lab), and a tab stays alive once opened, so a running test keeps going while you look
// at another one.
const TABS = [
  { id: 'convert', path: '/strategy-converter', label: 'Convert', icon: ArrowLeftRight, Panel: ConverterPanel },
  { id: 'test', path: '/strategy-tester', label: 'Test', icon: FlaskConical, Panel: TesterPanel },
  { id: 'market', path: '/market-lab', label: 'Market', icon: Microscope, Panel: MarketLabPanel },
];

export default function StrategyLab() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const active = TABS.find((t) => t.path === pathname) || TABS[0];
  const [opened, setOpened] = useState(() => new Set([active.id]));
  useEffect(() => { setOpened((s) => (s.has(active.id) ? s : new Set([...s, active.id]))); }, [active.id]);

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-clip">
      <header className="sticky top-0 z-30 h-14 glass-bar flex items-center gap-2 px-4">
        <Link to="/" className="p-2 rounded-md hover:bg-accent"><ArrowLeft className="w-4 h-4" /></Link>
        <h1 className="font-heading text-lg font-semibold mr-2">Strategy Lab</h1>
        <div role="tablist" aria-label="Strategy Lab" className="flex items-center gap-1 rounded-lg bg-accent/40 p-1">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={t.id === active.id} data-testid={`lab-tab-${t.id}`}
              onClick={() => navigate(t.path)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-sm ${t.id === active.id ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              <t.icon className="w-3.5 h-3.5" />{t.label}
            </button>
          ))}
        </div>
        <Link to="/test-history" className="ml-auto flex items-center gap-2 text-sm px-3 py-1.5 rounded-md hover:bg-accent">
          <History className="w-4 h-4 text-primary" />History
        </Link>
      </header>
      {TABS.filter((t) => opened.has(t.id)).map((t) => (
        <div key={t.id} role="tabpanel" hidden={t.id !== active.id}>
          <t.Panel />
        </div>
      ))}
    </div>
  );
}
