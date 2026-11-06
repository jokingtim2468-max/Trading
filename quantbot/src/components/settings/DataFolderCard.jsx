import { useEffect, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { client } from '@/api/client';
import { Button } from '@/components/ui/button';

// Settings > Tools & skills: the folder with the trader's MT5 CSV exports. The model's run_python tool gets it as
// QB_DATA, so the backtests it writes and runs read the real data.
export default function DataFolderCard() {
  const [dir, setDir] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => { client.auth.me().then((me) => setDir(me.mt5_data_dir || '')).catch(() => {}); }, []);
  const save = async () => { await client.auth.updateMe({ mt5_data_dir: dir.trim() }); setMsg('Saved. Scripts the model runs read it as QB_DATA.'); };
  return (
    <div className="bg-card border border-border rounded-2xl p-5 space-y-3" data-testid="data-folder-card">
      <div className="flex items-center gap-2">
        <FolderOpen className="w-5 h-5 text-primary" />
        <h3 className="font-semibold">MT5 data folder</h3>
        <span className="text-xs text-muted-foreground">Where your MT5 CSV exports are (XAUUSD M1-H4, NQ...)</span>
      </div>
      <div className="flex gap-2">
        <input className="flex-1 h-9 rounded-md border border-border bg-background px-2 text-sm font-mono" value={dir} onChange={(e) => setDir(e.target.value)} placeholder="C:\Users\you\gold-bot\data" data-testid="data-folder" />
        <Button size="sm" onClick={save}>Save</Button>
      </div>
      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
    </div>
  );
}
