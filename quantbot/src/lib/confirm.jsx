import { useEffect, useState } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// One confirmation dialog for the whole app: `await confirmAction({ title, message, action, danger })` resolves true
// when the trader presses the action button, false on Cancel / Esc / click outside. Used before every delete or change.
let show = null;
export function confirmAction({ title = 'Are you sure?', message = '', action = 'Confirm', danger = false } = {}) {
  if (!show) return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) => show({ title, message, action, danger, resolve }));
}

export function ConfirmHost() {
  const [ask, setAsk] = useState(null);
  useEffect(() => { show = setAsk; return () => { show = null; }; }, []);
  const done = (ok) => { ask?.resolve(ok); setAsk(null); };
  return (
    <AlertDialog open={!!ask} onOpenChange={(o) => !o && done(false)}>
      <AlertDialogContent data-testid="confirm-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{ask?.title}</AlertDialogTitle>
          {ask?.message && <AlertDialogDescription>{ask.message}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => done(false)} data-testid="confirm-cancel">Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => done(true)} data-testid="confirm-ok"
            className={ask?.danger ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}>{ask?.action}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
