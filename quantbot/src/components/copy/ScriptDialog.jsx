import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderOpen, Sparkles } from 'lucide-react';
import { client } from '@/api/client';
import { scriptHooks, logSetup } from '@/lib/copy';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import Field from '@/components/accounts/Field';
import CopyField from '@/components/signals/CopyField';

const LANGUAGES = ['Pine', 'MT5', 'Other'];

// The script's own chat: Claude only, with the script's folder (code, logs, trades, notes) as its context
export async function openScriptChat(script) {
  const { ChatSession } = client.entities;
  const found = (await ChatSession.filter({ script_id: script.id }, { sort: '-last_message_at', limit: 1 })).items[0];
  if (found) return found.id;
  const s = await ChatSession.create({ title: script.name, group: script.language === 'MT5' ? 'MT5' : 'Pine', script_id: script.id, last_message_at: new Date().toISOString() });
  await logSetup(`Claude chat opened for ${script.name}`, { script_id: script.id });
  return s.id;
}

// Add or edit a script. Claude writes and changes scripts (in the script's chat); each script has its own webhook
// address and its own folder next to QuantBot's logs with everything Claude needs for context.
export default function ScriptDialog({ script, config, onClose, onSaved, onDelete }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', language: 'Pine', code: '', ...script });
  const [busy, setBusy] = useState(false);
  const [folder, setFolder] = useState(null);
  const [folderError, setFolderError] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const hooks = script ? scriptHooks(config, script.id) : null;

  useEffect(() => {
    if (!script) return;
    fetch('/api/scripts/folders').then((r) => r.json()).then((f) => setFolder({ dir: f.scripts?.find((s) => s.id === script.id)?.dir || '', canOpen: f.canOpen })).catch(() => {});
  }, [script]);

  const saveData = async () => {
    const data = { name: form.name.trim(), language: form.language, code: form.code };
    const saved = script ? await client.entities.Script.update(script.id, data) : await client.entities.Script.create(data);
    if (!script) await logSetup(`Script ${saved.name} added (${saved.language}${saved.code ? `, ${saved.code.split('\n').length} lines` : ''})`, { script_id: saved.id });
    else if (script.name !== saved.name || script.code !== saved.code) await logSetup(`Script ${saved.name} edited${script.name !== saved.name ? ` (was ${script.name})` : ''}`, { script_id: saved.id });
    return saved;
  };
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const saved = await saveData();
    onSaved(saved, !script);
  };
  const withClaude = async () => {
    setBusy(true);
    const saved = await saveData();
    const id = await openScriptChat(saved);
    onClose();
    navigate(`/?chat=${id}`);
  };
  const openFolder = async () => {
    setFolderError('');
    const res = await fetch('/api/scripts/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: script.id }) });
    if (!res.ok) setFolderError((await res.json().catch(() => ({}))).error || 'Could not open the folder');
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{script ? 'Edit script' : 'Add script'}</DialogTitle></DialogHeader>
        <form onSubmit={save} className="space-y-3">
          <Field label="Name"><Input autoFocus value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Gold London-NY breakout" /></Field>
          <Field label="Language">
            <Select value={form.language} onValueChange={(v) => set('language', v)}>
              <SelectTrigger aria-label="Language"><SelectValue /></SelectTrigger>
              <SelectContent>{LANGUAGES.map((l) => <SelectItem key={l} value={l}>{l === 'MT5' ? 'MT5 (MQL5)' : l}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <div className="rounded-xl border border-primary/40 bg-primary/5 p-3 space-y-2">
            <p className="text-xs font-medium flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-primary" />Written with Claude</p>
            <p className="text-[11px] text-muted-foreground">
              The script has its own Claude chat. Claude reads the script&apos;s folder (code, activity log, trades, results, your notes)
              and every new version it writes becomes the script&apos;s code. Needs your Anthropic key (Settings).
            </p>
            <Button type="button" size="sm" onClick={withClaude} disabled={busy || !form.name.trim()}>
              <Sparkles className="w-3.5 h-3.5 mr-1" />{script ? 'Open its Claude chat' : 'Save and write it with Claude'}
            </Button>
          </div>
          <Field label="Code" hint="Claude writes this in the script's chat. You can also paste a script you already have.">
            <Textarea value={form.code} onChange={(e) => set('code', e.target.value)} rows={5} className="font-mono text-xs" placeholder="//@version=5" />
          </Field>
          {script && (
            <div className="rounded-xl border border-border p-3 space-y-2" data-testid="script-folder">
              <p className="text-xs font-medium">Its folder (for Claude)</p>
              <CopyField label="Folder" value={folder?.dir || ''} placeholder="Loading…" />
              <p className="text-[11px] text-muted-foreground">Next to QuantBot&apos;s logs. CLAUDE.md, the code, activity.log, trades.csv, summary.json and your notes.md, kept up to date. Point Claude Code or Claude Desktop at it for the full context.</p>
              {folder?.canOpen && <Button type="button" size="sm" variant="outline" onClick={openFolder}><FolderOpen className="w-3.5 h-3.5 mr-1" />Open folder</Button>}
              {folderError && <p className="text-[11px] text-destructive">{folderError}</p>}
            </div>
          )}
          {hooks ? (
            <div className="rounded-xl border border-border p-3 space-y-2">
              <p className="text-xs font-medium">This script&apos;s webhook</p>
              <CopyField label="TradingView alert URL" value={hooks.public} placeholder="Turn the public link on in Signals to get the address" />
              <CopyField label="MT5 / this PC" value={hooks.local} placeholder="Loading…" />
              <p className="text-[11px] text-muted-foreground">
                Point the script&apos;s alerts here. Each buy / sell is copied to every active account in its group at the alert&apos;s price,
                sized by the account&apos;s risk; set SL / TP and close follow.
              </p>
            </div>
          ) : <p className="text-[11px] text-muted-foreground">Save to get the script&apos;s own webhook address and folder.</p>}
          <DialogFooter className="gap-2">
            {script && <Button type="button" variant="ghost" className="text-destructive sm:mr-auto" disabled={busy}
              onClick={() => window.confirm(`Delete ${script.name}? Its trades stay in the history.`) && onDelete(script)}>Delete</Button>}
            <Button type="submit" disabled={busy || !form.name.trim()}>{busy ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
