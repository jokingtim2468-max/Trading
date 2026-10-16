import { useEffect, useState } from 'react';
import { client } from '@/api/client';
import { latestScript } from '@/lib/chatScript';
import { scriptHooks, logSetup } from '@/lib/copy';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import Field from '@/components/accounts/Field';
import CopyField from '@/components/signals/CopyField';

const LANGUAGES = ['Pine', 'MT5', 'Other'];

// Add or edit a script: paste its code or take the newest one from a QuantBot chat. Once saved it has its own
// webhook address; its alerts there are copied to every group it is dropped on.
export default function ScriptDialog({ script, config, onClose, onSaved, onDelete }) {
  const [form, setForm] = useState({ name: '', language: 'Pine', code: '', chat_id: '', ...script });
  const [chats, setChats] = useState([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const hooks = script ? scriptHooks(config, script.id) : null;

  useEffect(() => {
    client.entities.ChatSession.filter({}, { sort: '-last_message_at', limit: 30 }).then((p) => setChats(p.items)).catch(() => {});
  }, []);

  const fromChat = async (chatId) => {
    set('chat_id', chatId);
    setNote('Reading the chat…');
    const found = await latestScript(chatId).catch(() => null);
    if (!found) { setNote('No script in that chat yet.'); return; }
    const chat = chats.find((c) => c.id === chatId);
    setForm((f) => ({ ...f, code: found.code, language: found.language, name: f.name || chat?.title || '' }));
    setNote(`Took the newest ${found.language} script from the chat.`);
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const data = { name: form.name.trim(), language: form.language, code: form.code, chat_id: form.chat_id || '' };
    const saved = script ? await client.entities.Script.update(script.id, data) : await client.entities.Script.create(data);
    if (!script) await logSetup(`Script ${saved.name} added (${saved.language}${saved.code ? `, ${saved.code.split('\n').length} lines` : ''})`, { script_id: saved.id });
    else if (script.name !== saved.name || script.code !== saved.code) await logSetup(`Script ${saved.name} edited${script.name !== saved.name ? ` (was ${script.name})` : ''}`, { script_id: saved.id });
    onSaved(saved, !script);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{script ? 'Edit script' : 'Add script'}</DialogTitle></DialogHeader>
        <form onSubmit={save} className="space-y-3">
          <Field label="Name"><Input autoFocus value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Gold London-NY breakout" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Language">
              <Select value={form.language} onValueChange={(v) => set('language', v)}>
                <SelectTrigger aria-label="Language"><SelectValue /></SelectTrigger>
                <SelectContent>{LANGUAGES.map((l) => <SelectItem key={l} value={l}>{l === 'MT5' ? 'MT5 (MQL5)' : l}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="From a QuantBot chat">
              <Select value={form.chat_id || ''} onValueChange={fromChat} disabled={!chats.length}>
                <SelectTrigger aria-label="From a QuantBot chat"><SelectValue placeholder={chats.length ? 'Pick a chat' : 'No chats yet'} /></SelectTrigger>
                <SelectContent>{chats.map((c) => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
          {note && <p className="text-[11px] text-muted-foreground">{note}</p>}
          <Field label="Code (optional)" hint="Kept with the script so you can find it again. The script trades through its alerts, below.">
            <Textarea value={form.code} onChange={(e) => set('code', e.target.value)} rows={6} className="font-mono text-xs" placeholder="//@version=5" />
          </Field>
          {hooks ? (
            <div className="rounded-xl border border-border p-3 space-y-2">
              <p className="text-xs font-medium">This script's webhook</p>
              <CopyField label="TradingView alert URL" value={hooks.public} placeholder="Turn the public link on in Signals to get the address" />
              <CopyField label="MT5 / this PC" value={hooks.local} placeholder="Loading…" />
              <p className="text-[11px] text-muted-foreground">
                Point the script's alerts here. Each buy / sell is copied to every active account in its groups at the alert's price,
                sized by the account's risk; set SL / TP and close follow. Alerts sent to the plain Signals address are matched by the
                strategy name instead.
              </p>
            </div>
          ) : <p className="text-[11px] text-muted-foreground">Save to get the script's own webhook address.</p>}
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
