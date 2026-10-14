import { KeyRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import ApiKeyForm from './ApiKeyForm';
import { PROVIDERS } from '@/lib/models';

export default function NoKeyBanner({ provider, onSaved }) {
  return (
    <div className="px-4 md:px-6 pb-3">
      <div className="max-w-3xl mx-auto bg-card border border-primary/40 rounded-2xl p-4 space-y-3">
        <div className="flex items-start gap-3">
          <KeyRound className="w-5 h-5 text-primary mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium">Seems like there's no API linked. Would you like to add one?</p>
            <p className="text-xs text-muted-foreground mt-1">
              Paste your {PROVIDERS[provider].short} API key. It's encrypted before it's saved and never shown again.{' '}
              <Link to="/settings" className="text-primary underline">Manage in Settings</Link>
            </p>
          </div>
        </div>
        <ApiKeyForm provider={provider} onSaved={onSaved} />
      </div>
    </div>
  );
}