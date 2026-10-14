import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, FlaskConical } from 'lucide-react';
import SessionList from '@/components/history/SessionList';
import SessionDetail from '@/components/history/SessionDetail';

export default function TestHistory() {
  const [active, setActive] = useState(null);
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="h-14 border-b border-border flex items-center gap-3 px-4 shrink-0">
        <Link to="/" className="p-2 rounded-md hover:bg-accent"><ArrowLeft className="w-4 h-4" /></Link>
        <h1 className="font-heading text-lg font-semibold">Test history</h1>
        <Link to="/strategy-tester" className="ml-auto flex items-center gap-2 text-sm px-3 py-1.5 rounded-md hover:bg-accent">
          <FlaskConical className="w-4 h-4 text-primary" />New test
        </Link>
      </header>
      <div className="flex-1 flex flex-col md:flex-row md:h-[calc(100vh-3.5rem)]">
        <SessionList activeId={active?.id} onSelect={setActive} />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          {active ? <SessionDetail key={active.id} session={active} /> : (
            <p className="text-sm text-muted-foreground">Pick a saved test to see its code, rule check and results.</p>
          )}
        </main>
      </div>
    </div>
  );
}