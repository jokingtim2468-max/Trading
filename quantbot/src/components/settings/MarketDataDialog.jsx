import { useState } from 'react';
import { client } from '@/api/client';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FolderOpen, FileUp } from 'lucide-react';
import Field from '@/components/accounts/Field';
import MarketFileRow from '@/components/settings/MarketFileRow';
import { readCandleFile } from '@/lib/backtest/readCandleFile';

export default function MarketDataDialog({ onClose, onSaved }) {
  const [items, setItems] = useState([]);
  const [shared, setShared] = useState({ contract_size: '100', point: '0.01' });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  const pick = async (e) => {
    const files = [...(e.target.files || [])].filter((f) => /\.(csv|txt)$/i.test(f.name));
    e.target.value = '';
    if (!files.length) return setError('No CSV files found.');
    setError('');
    setProgress('Reading files…');
    const read = await Promise.all(files.map(readCandleFile));
    setProgress('');
    setItems(read);
  };

  const update = (i, patch) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const valid = items.filter((x) => x.info && x.symbol.trim() && x.timeframe.trim());

  const save = async () => {
    setBusy(true);
    try {
      for (let i = 0; i < valid.length; i++) {
        const x = valid[i];
        setProgress(`Saving ${i + 1} of ${valid.length}…`);
        const { file_uri } = await client.files.upload({ file: x.file });
        await client.entities.MarketData.create({
          ...x.info, file_uri, symbol: x.symbol.trim().toUpperCase(), timeframe: x.timeframe.trim().toUpperCase(),
          contract_size: Number(shared.contract_size) || 100, point: Number(shared.point) || 0.01,
        });
      }
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
      setProgress('');
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Add candle data</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" asChild><label className="cursor-pointer"><FolderOpen /> Pick folder<input type="file" webkitdirectory="" directory="" multiple hidden onChange={pick} /></label></Button>
            <Button variant="outline" asChild><label className="cursor-pointer"><FileUp /> Pick files<input type="file" accept=".csv,.txt" multiple hidden onChange={pick} /></label></Button>
          </div>
          {items.length > 0 && (
            <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
              {items.map((x, i) => <MarketFileRow key={i} item={x} onChange={(p) => update(i, p)} />)}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Contract size" hint="Units per 1.0 lot, all files"><Input value={shared.contract_size} onChange={(e) => setShared((s) => ({ ...s, contract_size: e.target.value }))} /></Field>
            <Field label="Point" hint="Price of 1 point, all files"><Input value={shared.point} onChange={(e) => setShared((s) => ({ ...s, point: e.target.value }))} /></Field>
          </div>
          {progress && <p className="text-xs text-muted-foreground">{progress}</p>}
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={!valid.length || busy}>{busy ? 'Saving…' : `Save ${valid.length || ''} file${valid.length === 1 ? '' : 's'}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}