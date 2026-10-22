import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Minus, Square, Copy, X } from 'lucide-react';
import LogoMark from '@/components/quant/LogoMark';
import ModelStatus from '@/components/ModelStatus';

const PAGES = {
  '/': 'Chat', '/settings': 'Settings', '/strategy-lab': 'Strategy Lab', '/strategy-tester': 'Strategy Lab · Test', '/strategy-converter': 'Strategy Lab · Convert', '/market-lab': 'Strategy Lab · Market',
  '/test-history': 'Test history', '/pnl': 'PnL calendar', '/accounts': 'Copy trading', '/scaling': 'Scaling planner',
};

// The desktop app's own title bar (the window has no Windows frame): logo, name, the page you're on, and window
// buttons in QuantBot's colors. Drag it to move the window; double-click it to maximize. Only in the desktop app.
export const desktop = typeof window !== 'undefined' ? window.quantbotDesktop : null;

function WinButton({ label, onClick, danger, children }) {
  return (
    <button
      type="button" aria-label={label} title={label} onClick={onClick}
      className={`app-no-drag h-full w-12 grid place-items-center text-muted-foreground transition-colors ${danger ? 'hover:bg-destructive hover:text-white' : 'hover:bg-foreground/10 hover:text-foreground'}`}
    >
      {children}
    </button>
  );
}

export default function TitleBar() {
  const { pathname } = useLocation();
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!desktop) return undefined;
    desktop.isMaximized().then(setMaximized);
    return desktop.onMaximizedChange(setMaximized);
  }, []);
  if (!desktop) return null;
  return (
    <div className="app-drag fixed top-0 inset-x-0 z-[90] h-[var(--titlebar)] flex items-center bg-sidebar border-b border-white/5 select-none" onDoubleClick={() => desktop.toggleMaximize()}>
      <div className="flex items-center gap-2 pl-3 min-w-0">
        <LogoMark className="w-5 h-5" />
        <span className="font-heading text-[13px] font-semibold text-foreground/90">QuantBot</span>
        <span className="text-xs text-muted-foreground truncate">{PAGES[pathname] || ''}</span>
      </div>
      <div className="ml-auto flex h-full" onDoubleClick={(e) => e.stopPropagation()}>
        <ModelStatus />
        <WinButton label="Minimize" onClick={() => desktop.minimize()}><Minus className="w-4 h-4" /></WinButton>
        <WinButton label={maximized ? 'Restore' : 'Maximize'} onClick={() => desktop.toggleMaximize()}>
          {maximized ? <Copy className="w-3.5 h-3.5 -scale-x-100" /> : <Square className="w-3.5 h-3.5" />}
        </WinButton>
        <WinButton label="Close" danger onClick={() => desktop.close()}><X className="w-4 h-4" /></WinButton>
      </div>
    </div>
  );
}
