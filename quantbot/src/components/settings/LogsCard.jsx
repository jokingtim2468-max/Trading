import { useEffect, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Desktop app only: where QuantBot writes its log (the "logs" folder in the install folder) and a button that opens it
export default function LogsCard() {
  const desktop = window.quantbotDesktop;
  const [file, setFile] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { desktop?.logsPath?.().then((p) => setFile(p || '')).catch(() => {}); }, [desktop]);
  if (!desktop?.openLogs) return null;

  const open = async () => {
    setError('');
    const problem = await desktop.openLogs().catch((e) => e.message);
    if (problem) setError(`Couldn't open the folder: ${problem}`);
  };

  return (
    <section className="mt-8 space-y-3">
      <h2 className="font-heading text-lg font-semibold">Logs</h2>
      <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
        <div>
          <h3 className="font-medium">QuantBot's log file</h3>
          <p className="text-xs text-muted-foreground">
            Startup, downloads, updates and errors are written here. Send this file when something goes wrong.
          </p>
          {file && <p data-testid="log-path" className="mt-2 text-xs font-mono break-all text-muted-foreground">{file}</p>}
        </div>
        <Button size="sm" variant="outline" onClick={open}><FolderOpen className="w-3.5 h-3.5" />Open logs folder</Button>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </section>
  );
}
