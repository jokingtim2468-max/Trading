import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Lock } from 'lucide-react';
import { getKeyStatus } from '@/lib/quantApi';
import ProviderKeyCard from '@/components/quant/ProviderKeyCard';
import DefaultModelsCard from '@/components/settings/DefaultModelsCard';
import LocalModelCard from '@/components/settings/LocalModelCard';
import BuiltInMarketsCard from '@/components/settings/BuiltInMarketsCard';
import UpdatesCard from '@/components/settings/UpdatesCard';
import MotionCard from '@/components/settings/MotionCard';
import LogsCard from '@/components/settings/LogsCard';

export default function Settings() {
  const [status, setStatus] = useState(null);

  useEffect(() => { getKeyStatus().then(setStatus); }, []);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 md:px-6 py-8">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back to chat
        </Link>
        <h1 className="font-heading text-3xl mt-6">Settings</h1>

        <section className="mt-8 space-y-3">
          <h2 className="font-heading text-lg font-semibold">API Keys</h2>
          <ProviderKeyCard provider="anthropic" status={status} onChange={setStatus} />
          <ProviderKeyCard provider="google" status={status} onChange={setStatus} />
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            Keys are encrypted (AES-256-GCM) and stored only on this PC. They are only sent to Claude or Gemini when you use them.
          </p>
        </section>

        <section className="mt-8 space-y-3">
          <h2 className="font-heading text-lg font-semibold">Models</h2>
          <DefaultModelsCard />
          <LocalModelCard />
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

      </div>
    </div>
  );
}