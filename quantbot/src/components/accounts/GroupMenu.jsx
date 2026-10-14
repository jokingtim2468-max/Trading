import { MoreHorizontal } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

export default function GroupMenu({ group, onRename, onToggle, onDelete }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="pr-2.5 -ml-1 py-1.5"><MoreHorizontal className="w-4 h-4" /></DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onClick={() => onRename(group)}>Rename</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onToggle(group)}>{group.enabled === false ? 'Resume copying' : 'Pause copying'}</DropdownMenuItem>
        <DropdownMenuItem className="text-destructive" onClick={() => onDelete(group)}>Delete group</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}