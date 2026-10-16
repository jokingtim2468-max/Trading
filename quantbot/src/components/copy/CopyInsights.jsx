import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ActivityLog from './ActivityLog';
import Evaluate from './Evaluate';

// Below the accounts: the activity log and the evaluation, for the selected group or everything
export default function CopyInsights({ data, scope }) {
  const group = data.groups.find((g) => g.id === scope);
  const props = { accounts: data.accounts || [], groups: data.groups, scripts: data.scripts, scope: group ? group.id : null };
  return (
    <section className="bg-card border border-border rounded-2xl p-4 md:p-5 shadow-raised" aria-label="Copy trading activity">
      <Tabs defaultValue="activity">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <TabsList>
            <TabsTrigger value="activity">Activity log</TabsTrigger>
            <TabsTrigger value="evaluate">Evaluate</TabsTrigger>
          </TabsList>
          <span className="text-xs text-muted-foreground">{group ? `${group.name} only` : 'All groups'}</span>
        </div>
        <TabsContent value="activity"><ActivityLog events={data.events} {...props} /></TabsContent>
        <TabsContent value="evaluate"><Evaluate trades={data.trades} {...props} /></TabsContent>
      </Tabs>
    </section>
  );
}
