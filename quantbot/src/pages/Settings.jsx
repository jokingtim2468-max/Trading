import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import LocalModelCard from '@/components/settings/LocalModelCard';
import AgentTeamCard from '@/components/settings/AgentTeamCard';
import BuiltInMarketsCard from '@/components/settings/BuiltInMarketsCard';
import UpdatesCard from '@/components/settings/UpdatesCard';
import MotionCard from '@/components/settings/MotionCard';
import LogsCard from '@/components/settings/LogsCard';
import Mt5AccountsCard from '@/components/settings/Mt5AccountsCard';
import DaemonCard from '@/components/settings/DaemonCard';
import VpsGuideCard from '@/components/settings/VpsGuideCard';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function Settings() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'deploy' ? 'deploy' : 'general';


  return (
    <div className="min-h-screen bg-background">
      <div className={`${tab === 'deploy' ? 'max-w-4xl' : 'max-w-2xl'} mx-auto px-4 md:px-6 py-8`}>
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back to chat
        </Link>
        <h1 className="font-heading text-3xl mt-6">Settings</h1>

        <Tabs value={tab} onValueChange={(v) => setParams(v === 'deploy' ? { tab: 'deploy' } : {}, { replace: true })} className="mt-6">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="deploy">MT5 &amp; deployment</TabsTrigger>
        </TabsList>
        <TabsContent value="general">
        <section className="mt-8 space-y-3">
          <h2 className="font-heading text-lg font-semibold">Models</h2>
          <LocalModelCard />
          <AgentTeamCard />
        </section>

        <section className="mt-8 space-y-3">
          <h2 className="font-heading text-lg font-semibold">Market data</h2>
          <BuiltInMarketsCard />
        </section>

        <section className="mt-8 space-y-3">
          <h2 className="font-heading text-lg font-semibold">Motion</h2>
          <MotionCard />
        </section>

        <UpdatesCard />
        <LogsCard />
        </TabsContent>
        <TabsContent value="deploy">
          <section className="mt-6 space-y-3">
            <h2 className="font-heading text-lg font-semibold">Multi-broker MT5 accounts</h2>
            <Mt5AccountsCard />
            <DaemonCard />
          </section>
          <section className="mt-8 space-y-3">
            <h2 className="font-heading text-lg font-semibold">Run 24/7</h2>
            <VpsGuideCard />
          </section>
        </TabsContent>
        </Tabs>

      </div>
    </div>
  );
}