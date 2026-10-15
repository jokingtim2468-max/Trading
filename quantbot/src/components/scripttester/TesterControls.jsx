import { Play, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DatasetPicker from '@/components/tester/DatasetPicker';
import RangeFields from '@/components/tester/RangeFields';

export default function TesterControls({ chats, datasets, chatId, datasetIds, onChat, onDatasets, range, rangeLimits, onRange, onRun, onStop, running }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex flex-wrap items-end gap-3">
      <label className="space-y-1 flex-1 min-w-[220px]">
        <span className="text-xs text-muted-foreground">Chat with the script</span>
        <Select value={chatId} onValueChange={onChat}>
          <SelectTrigger className="h-10"><SelectValue placeholder={chats.length ? 'Pick a chat' : 'No chats yet'} /></SelectTrigger>
          <SelectContent>
            {chats.map((c) => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}
          </SelectContent>
        </Select>
      </label>
      <label className="space-y-1 w-full sm:w-60">
        <span className="text-xs text-muted-foreground">Markets</span>
        <DatasetPicker datasets={datasets} value={datasetIds} onChange={onDatasets} />
      </label>
      <RangeFields {...range} {...rangeLimits} onChange={onRange} />
      {running ? (
        <Button variant="outline" onClick={onStop} className="h-10 bg-transparent"><Square className="w-4 h-4 mr-2" />Stop</Button>
      ) : (
        <Button onClick={onRun} disabled={!chatId || !datasetIds.length || !range.from || !range.to} className="h-10">
          <Play className="w-4 h-4 mr-2" />Run test
        </Button>
      )}
    </div>
  );
}