import { Plus, X, FlaskConical, History, CalendarDays, ArrowLeftRight, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import GroupPills from './GroupPills';
import ProfileFooter from './ProfileFooter';
import SessionItem from './SessionItem';

export default function QuantSidebar({ user, sessions, activeId, activeGroup, onSelect, onNew, onGroup, onRename, onMove, onDelete, open, onClose }) {
  return (
    <>
      {open && <div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={onClose} />}
      <aside className={`fixed md:static z-40 inset-y-0 left-0 w-72 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col transition-transform ${open ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}>
        <div className="h-14 flex items-center justify-between px-4">
          <span className="font-heading text-lg font-semibold">QuantBot</span>
          <button onClick={onClose} className="md:hidden p-1 rounded hover:bg-sidebar-accent"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-3">
          <button onClick={onNew} className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-sidebar-accent text-sm font-medium">
            <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center"><Plus className="w-4 h-4" /></span>
            New chat
          </button>
          <Link to="/strategy-tester" className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-sidebar-accent text-sm font-medium">
            <span className="w-6 h-6 rounded-full bg-sidebar-accent flex items-center justify-center"><FlaskConical className="w-4 h-4 text-primary" /></span>
            Strategy Tester
          </Link>
          <Link to="/strategy-converter" className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-sidebar-accent text-sm font-medium">
            <span className="w-6 h-6 rounded-full bg-sidebar-accent flex items-center justify-center"><ArrowLeftRight className="w-4 h-4 text-primary" /></span>
            Strategy Converter
          </Link>
          <Link to="/test-history" className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-sidebar-accent text-sm font-medium">
            <span className="w-6 h-6 rounded-full bg-sidebar-accent flex items-center justify-center"><History className="w-4 h-4 text-primary" /></span>
            Test history
          </Link>
          <Link to="/pnl" className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-sidebar-accent text-sm font-medium">
            <span className="w-6 h-6 rounded-full bg-sidebar-accent flex items-center justify-center"><CalendarDays className="w-4 h-4 text-primary" /></span>
            PnL calendar
          </Link>
          <Link to="/accounts" className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-sidebar-accent text-sm font-medium">
            <span className="w-6 h-6 rounded-full bg-sidebar-accent flex items-center justify-center"><Wallet className="w-4 h-4 text-primary" /></span>
            Accounts
          </Link>
        </div>
        <GroupPills active={activeGroup} onSelect={onGroup} />
        <div className="px-4 pt-3 pb-1 text-xs text-muted-foreground">Recents</div>
        <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-0.5">
          {sessions.length === 0 && <p className="px-2 py-2 text-xs text-muted-foreground">No conversations yet.</p>}
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