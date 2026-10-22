import { Plus, X, FlaskConical, History, CalendarDays, Wallet, Cpu, Radio, CandlestickChart, BookOpen, LayoutGrid, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import GroupPills from './GroupPills';
import ProfileFooter from './ProfileFooter';
import SessionItem from './SessionItem';

// Pages grouped by job, one compact row each: build strategies, trade, run accounts, review results
const NAV = [
  ['Build', [['/strategy-lab', 'Strategy Lab', 'Lab', FlaskConical], ['/test-history', 'Test history', 'Tests', History], ['/train', 'Train', 'Train', Cpu]]],
  ['Trade', [['/terminal', 'Terminal', 'Terminal', CandlestickChart], ['/signals', 'Signals', 'Signals', Radio]]],
  ['Accounts', [['/accounts', 'Copy trading', 'Copy', Wallet], ['/overview', 'Overview', 'Stats', LayoutGrid], ['/scaling', 'Scaling planner', 'Scaling', TrendingUp]]],
  ['Results', [['/pnl', 'PnL calendar', 'PnL', CalendarDays], ['/journal', 'Journal', 'Journal', BookOpen]]],
];

// On phones the sidebar slides in from the left and fades; on desktop it is always shown
export default function QuantSidebar({ user, sessions, activeId, activeGroup, onSelect, onNew, onGroup, onRename, onMove, onDelete, open, onClose }) {
  return (
    <>
      <div className={`fixed inset-0 bg-black/50 z-30 md:hidden transition-opacity duration-pop ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={onClose} />
      <aside
        className={`fixed md:static z-40 inset-y-0 left-0 w-72 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col transition-[transform,opacity] calm:transition-none duration-pop ease-pop ${open ? 'translate-x-0 opacity-100' : '-translate-x-full opacity-0 pointer-events-none'} md:translate-x-0 md:opacity-100 md:pointer-events-auto`}
      >
        <div className="h-14 flex items-center justify-between px-4">
          <span className="font-heading text-lg font-semibold">QuantBot</span>
          <button onClick={onClose} className="md:hidden p-1 rounded hover:bg-sidebar-accent"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-3">
          <button onClick={onNew} className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-sidebar-accent text-sm font-medium">
            <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center"><Plus className="w-4 h-4" /></span>
            New chat
          </button>
          <nav className="mt-1 space-y-1.5" aria-label="Pages">
            {NAV.map(([group, links]) => (
              <div key={group} className="flex items-center gap-1">
                <span className="w-14 shrink-0 px-2 text-[10px] text-muted-foreground">{group}</span>
                <div className="flex flex-wrap gap-0.5">
                  {links.map(([to, name, short, Icon]) => (
                    <Link key={to} to={to} aria-label={name} title={name}
                      className="flex items-center gap-1 h-6 px-1 rounded-md text-xs hover:bg-sidebar-accent active:scale-[0.97] transition">
                      <Icon className="w-3.5 h-3.5 text-primary" />{short}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </div>
        <GroupPills active={activeGroup} onSelect={onGroup} />
        <div className="px-4 pt-3 pb-1 text-xs text-muted-foreground">Recents</div>
        <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-0.5">
          {sessions.length === 0 && <p className="px-2 py-2 text-xs text-muted-foreground">Your chats show up here. Ask for an EA or indicator, or convert a strategy to get a chat linked to its tests.</p>}
          {sessions.map((s) => (
            <SessionItem
              key={s.id} session={s} active={s.id === activeId}
              onSelect={onSelect} onRename={onRename} onMove={onMove} onDelete={onDelete}
            />
          ))}
        </div>
        <ProfileFooter user={user} />
      </aside>
    </>
  );
}