import { useState } from 'react';
import { client } from '@/api/client';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FAMILIES } from '@/lib/accounts';
import { logSetup } from '@/lib/copy';
import Field from './Field';

export default function GroupDialog({ group, family: initialFamily = 'Futures', onClose, onSaved }) {
  const [name, setName] = useState(group.name || '');
  const [family, setFamily] = useState(group.platform === 'MT5' ? 'MT5' : group.id ? 'Futures' : initialFamily);
  const [saving, setSaving] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    const { CopyGroup } = client.entities;
    if (group.id) {
      await CopyGroup.update(group.id, { name: name.trim() });
      onSaved(null);
    } else {
      const g = await CopyGroup.create({ name: name.trim(), platform: family, enabled: true });
      await logSetup(`Group ${g.name} created (${family === 'MT5' ? 'MT5' : 'futures'})`, { group_id: g.id });
      onSaved(g);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{group.id ? 'Rename group' : 'New copy group'}</DialogTitle></DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <Field label="Name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lucid 50K accounts" /></Field>
          {!group.id && (
            <Field label="Accounts in this group" hint="Futures groups copy with Tradovate Group Trade (Tradovate and TradingView accounts from the same prop firm).">
              <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Group type">
                {Object.entries(FAMILIES).map(([id, label]) => (
                  <button key={id} type="button" role="radio" aria-checked={family === id} onClick={() => setFamily(id)}
                    className={`text-left px-3 py-2 rounded-lg border text-sm ${family === id ? 'border-primary bg-primary/10' : 'border-border text-muted-foreground hover:bg-accent'}`}>{label}</button>
                ))}
              </div>
            </Field>
          )}
          <DialogFooter>
            <Button type="submit" disabled={!name.trim() || saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
