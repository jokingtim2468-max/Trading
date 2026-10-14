import CopyLogRow from './CopyLogRow';

export default function CopyLog({ log, accounts }) {
  const name = (id) => accounts.find((a) => a.id === id)?.label || 'Removed account';
  return (
    <section className="bg-card border border-border rounded-2xl p-4 md:p-5">
      <h2 className="font-heading text-lg font-semibold">Copy log</h2>
      <p className="text-xs text-muted-foreground mb-2">"Sent within" is how close together the copies left QuantBot. Broker time is how long each broker took to fill.</p>
      {!log.length ? <p className="text-sm text-muted-foreground">No copied trades yet.</p> : (
        <div className="divide-y divide-border">
          {log.map((ev) => <CopyLogRow key={ev.id} ev={ev} name={name} />)}
        </div>
      )}
    </section>
  );
}