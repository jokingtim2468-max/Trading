import { Settings } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function ProfileFooter({ user }) {
  const name = user?.full_name || 'Trader';
  return (
    <div className="border-t border-sidebar-border p-3">
      <div className="flex items-center gap-3 px-1">
        <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-semibold shrink-0">
          {name[0]?.toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{name}</div>
          <div className="text-xs text-muted-foreground truncate">{user?.email}</div>
        </div>
        <Link to="/settings" title="Settings" className="p-2 rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground">
          <Settings className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}