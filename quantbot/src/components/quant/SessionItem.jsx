import { useState } from 'react';
import { MoreHorizontal, Trash2, Pencil, FolderInput } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import DeleteChatDialog from './DeleteChatDialog';

const GROUPS = ['MT5', 'Pine'];

export default function SessionItem({ session, active, onSelect, onRename, onMove, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(session.title);

  const saveTitle = () => {
    setEditing(false);
    const t = title.trim();
    if (t && t !== session.title) onRename(session.id, t);
    else setTitle(session.title);
  };

  if (editing) {
    return (
      <input
        autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle}
        onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') { setTitle(session.title); setEditing(false); } }}
        className="w-full px-2 py-1.5 rounded-md text-sm bg-background border border-primary outline-none"
      />
    );
  }

  const showActions = menuOpen ? 'flex' : 'hidden group-hover:flex';
  const iconBtn = 'p-1 rounded hover:bg-background/70 text-muted-foreground hover:text-foreground';

  return (
    <div className={`group relative flex items-center rounded-md ${active ? 'bg-sidebar-accent text-foreground' : 'text-sidebar-foreground/80 hover:bg-sidebar-accent'}`}>
      <button onClick={() => onSelect(session.id)} className="flex-1 min-w-0 text-left truncate px-2 py-1.5 text-sm">
        {session.title}
      </button>
      <div className={`${showActions} items-center gap-0.5 pr-1`}>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button className={iconBtn} aria-label="Chat settings"><MoreHorizontal className="w-4 h-4" /></button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44" onCloseAutoFocus={(e) => e.preventDefault()}>
            <DropdownMenuItem onClick={() => setEditing(true)}><Pencil className="w-4 h-4 mr-2" />Rename</DropdownMenuItem>
            <DropdownMenuSeparator />
            {GROUPS.filter((g) => g !== session.group).map((g) => (
              <DropdownMenuItem key={g} onClick={() => onMove(session.id, g)}>
                <FolderInput className="w-4 h-4 mr-2" />Move to {g}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <button onClick={() => setConfirmOpen(true)} className={`${iconBtn} hover:text-destructive`} aria-label="Delete chat">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      <DeleteChatDialog open={confirmOpen} onOpenChange={setConfirmOpen} title={session.title} onConfirm={() => onDelete(session.id)} />
    </div>
  );
}