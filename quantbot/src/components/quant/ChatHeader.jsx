import { Download, Trash2, Menu, Folder } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GROUPS } from '@/lib/models';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function ChatHeader({ session, onGroupChange, onExport, onDelete, onMenu }) {
  return (
    <header className="h-14 shrink-0 border-b border-border flex items-center justify-between gap-3 px-3 md:px-4">
      <div className="flex items-center gap-2 min-w-0">
        <button onClick={onMenu} className="md:hidden p-2 rounded-md hover:bg-accent"><Menu className="w-5 h-5" /></button>
        {session && (
          <>
            <span className="truncate text-sm font-medium">{session.title}</span>
            <Select value={GROUPS.some((g) => g.value === session.group) ? session.group : undefined} onValueChange={onGroupChange}>
              <SelectTrigger className="h-7 w-auto gap-1.5 border-border bg-transparent text-xs text-muted-foreground">
                <Folder className="w-3 h-3" /><SelectValue placeholder="Project" />
              </SelectTrigger>
              <SelectContent>
                {GROUPS.map((g) => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </>
        )}
      </div>
      {session && (
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={onExport} className="h-8 bg-transparent">
            <Download className="w-3.5 h-3.5" /><span className="hidden sm:inline">Export .md</span>
          </Button>
          <Button variant="outline" size="sm" onClick={onDelete} className="h-8 bg-transparent text-destructive border-destructive/40 hover:text-destructive">
            <Trash2 className="w-3.5 h-3.5" /><span className="hidden sm:inline">Delete</span>
          </Button>
        </div>
      )}
    </header>
  );
}