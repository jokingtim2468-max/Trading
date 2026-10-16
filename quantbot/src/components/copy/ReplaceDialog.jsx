import { useRef } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

// Asked when a change would put a second script's trades on an account: replace (clears the other) or keep.
// Exactly one answer is given per question (closing it any other way counts as keep).
export default function ReplaceDialog({ ask, onReplace, onKeep }) {
  const answered = useRef(null);
  if (!ask) return null;
  const answer = (fn) => { if (answered.current === ask) return; answered.current = ask; fn(); };
  return (
    <AlertDialog open onOpenChange={(o) => !o && answer(onKeep)}>
      <AlertDialogContent data-testid="replace-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>There is already one on this account</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>{ask.text}</p>
              <p>Would you like to replace it? This clears <b className="text-foreground">{ask.oldName}</b> from the account{ask.count ? ` and its ${ask.count} open trade${ask.count === 1 ? '' : 's'}` : ''}. One account only ever holds one script&apos;s trades.</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => answer(onKeep)}>Keep {ask.oldName}</AlertDialogCancel>
          <AlertDialogAction onClick={() => answer(onReplace)}>Yes, replace it</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
