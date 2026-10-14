import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Lock } from 'lucide-react';
import { getKeyStatus } from '@/lib/quantApi';
import ProviderKeyCard from '@/components/quant/ProviderKeyCard';
import DefaultModelsCard from '@/components/settings/DefaultModelsCard';
import MarketDataCard from '@/components/settings/MarketDataCard';

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
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">API Keys</h2>
          <ProviderKeyCard provider="anthropic" status={status} onChange={setStatus} />
          <ProviderKeyCard provider="google" status={status} onChange={setStatus} />
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            Keys are encrypted (AES-256-GCM) and stored only on this PC. They are only sent to Claude or Gemini when you use them.
          </p>
        </section>

        <section className="mt-8 space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Models</h2>
          <DefaultModelsCard />
        </section>

        <section className="mt-8 space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Market data</h2>
          <MarketDataCard />
        </section>

      </div>
    </div>
  );
}