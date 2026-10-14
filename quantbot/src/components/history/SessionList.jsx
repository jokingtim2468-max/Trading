import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { client } from '@/api/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import SessionCard from './SessionCard';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export default function SessionList({ activeId, onSelect }) {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async (more) => {
    setLoading(true);
    const q = search.trim();
    const page = await client.entities.TestSession.filter(
      q ? { bot_name: { $regex: escape(q), $options: 'i' } } : {},
      { sort: '-last_run_at', limit: 30, ...(more ? { cursor } : {}) },
    );
    const next = more ? [...items, ...page.items] : page.items;
    setItems(next);
    setCursor(page.has_more ? page.next_cursor : null);
    setLoading(false);
    if (!more && !activeId && next[0]) onSelect(next[0]);
  };

  useEffect(() => { const t = setTimeout(() => load(false), 300); return () => clearTimeout(t); }, [search]);

  return (
    <aside className="md:w-80 shrink-0 border-b md:border-b-0 md:border-r border-border flex flex-col max-h-[40vh] md:max-h-none">
      <div className="p-3 relative">
        <Search className="w-4 h-4 absolute left-6 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search bots" className="pl-9 bg-card" />
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2">
        {!loading && !items.length && <p className="text-sm text-muted-foreground px-1">No saved tests yet. Run one in the Strategy Tester.</p>}
        {items.map((s) => <SessionCard key={s.id} session={s} active={s.id === activeId} onSelect={onSelect} />)}
        {loading && <p className="text-xs text-muted-foreground px-1">Loading...</p>}
        {cursor && !loading && <Button variant="outline" size="sm" className="w-full bg-transparent" onClick={() => load(true)}>Load more</Button>}
      </div>
    </aside>
  );
}