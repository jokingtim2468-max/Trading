import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider } from '@/lib/AuthContext';
import ScrollToTop from './components/ScrollToTop';
import TitleBar from '@/components/TitleBar';
import ProtectedRoute from '@/components/ProtectedRoute';
import QuantChat from '@/pages/QuantChat';
import Settings from '@/pages/Settings';
import StrategyLab from '@/pages/StrategyLab';
import TestHistory from '@/pages/TestHistory';
import PnlCalendar from '@/pages/PnlCalendar';
import Accounts from '@/pages/Accounts';
import Signals from '@/pages/Signals';
import Train from '@/pages/Train';
import Terminal from '@/pages/Terminal';
import Journal from '@/pages/Journal';
import Overview from '@/pages/Overview';

const AuthenticatedApp = () => (
  <Routes>
    <Route element={<ProtectedRoute />}>
      <Route path="/" element={<QuantChat />} />
      <Route path="/settings" element={<Settings />} />
      {/* one layout route, so the Lab (and a running test) stays mounted while you switch its tabs */}
      <Route element={<StrategyLab />}>
        <Route path="/strategy-lab" element={null} />
        <Route path="/strategy-converter" element={null} />
        <Route path="/strategy-tester" element={null} />
        <Route path="/market-lab" element={null} />
      </Route>
      <Route path="/test-history" element={<TestHistory />} />
      <Route path="/pnl" element={<PnlCalendar />} />
      <Route path="/accounts" element={<Accounts />} />
      <Route path="/signals" element={<Signals />} />
      <Route path="/train" element={<Train />} />
      <Route path="/terminal" element={<Terminal />} />
      <Route path="/journal" element={<Journal />} />
      <Route path="/overview" element={<Overview />} />
    </Route>
    <Route path="*" element={<PageNotFound />} />
  </Routes>
);

function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <ScrollToTop />
          <TitleBar />
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App