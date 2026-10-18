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
import StrategyTester from '@/pages/StrategyTester';
import StrategyConverter from '@/pages/StrategyConverter';
import TestHistory from '@/pages/TestHistory';
import PnlCalendar from '@/pages/PnlCalendar';
import Accounts from '@/pages/Accounts';
import Signals from '@/pages/Signals';
import Train from '@/pages/Train';
import Terminal from '@/pages/Terminal';
import Journal from '@/pages/Journal';

const AuthenticatedApp = () => (
  <Routes>
    <Route element={<ProtectedRoute />}>
      <Route path="/" element={<QuantChat />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/strategy-tester" element={<StrategyTester />} />
      <Route path="/strategy-converter" element={<StrategyConverter />} />
      <Route path="/test-history" element={<TestHistory />} />
      <Route path="/pnl" element={<PnlCalendar />} />
      <Route path="/accounts" element={<Accounts />} />
      <Route path="/signals" element={<Signals />} />
      <Route path="/train" element={<Train />} />
      <Route path="/terminal" element={<Terminal />} />
      <Route path="/journal" element={<Journal />} />
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