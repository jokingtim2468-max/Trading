import { useAuth } from '@/lib/AuthContext';
import PageTransition from '@/components/PageTransition';

const Spinner = () => (
  <div className="fixed inset-0 flex items-center justify-center">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
  </div>
);

// Pages wait for the local profile; if the local server is down, say so instead of spinning forever
export default function ProtectedRoute() {
  const { isLoading, error } = useAuth();

  if (error) {
    return (
      <div className="fixed inset-0 flex items-center justify-center p-6 text-center">
        <div className="max-w-sm space-y-2">
          <h1 className="font-heading text-2xl">QuantBot server not reachable</h1>
          <p className="text-sm text-muted-foreground">Start it with <code>npm start</code> in the quantbot folder, then reload this page.</p>
        </div>
      </div>
    );
  }
  if (isLoading) return <Spinner />;
  return <PageTransition />;
}
