import { useState } from 'react';
import { client } from '@/api/client';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function GroupDialog({ group, platform, onClose, onSaved }) {
  const [name, setName] = useState(group.name || '');
  const [saving, setSaving] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    const { CopyGroup } = client.entities;
    if (group.id) {
      await CopyGroup.update(group.id, { name: name.trim() });
      onSaved(null);
    } else {
      onSaved(await CopyGroup.create({ name: name.trim(), platform, enabled: true }));
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{group.id ? 'Rename group' : 'New copy group'}</DialogTitle></DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lucid 50K accounts" />
          <DialogFooter>
            <Button type="submit" disabled={!name.trim() || saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}