import { useState, useRef } from 'react';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { BootSequence } from '@/components/BootSequence';
import { AppShell } from '@/components/AppShell';
import { AuthPage } from '@/pages/AuthPage';
import { Dashboard } from '@/pages/Dashboard';
import { FileBrowser } from '@/pages/FileBrowser';
import { Settings } from '@/pages/Settings';
import { PasswordResetPage } from '@/pages/PasswordResetPage';
import { useEdgeSwipeBack } from '@/hooks/useEdgeSwipeBack';
import { isSupabaseConfigured } from '@/lib/supabase';

type Page =
  | 'dashboard' | 'all' | 'video' | 'photo' | 'document' | 'other'
  | 'favorites' | 'recent' | 'trash' | 'settings';

function AppContent() {
  const { user, loading } = useAuth();
  const [booted, setBooted] = useState(false);
  const [page, setPage] = useState<Page>('dashboard');
  const historyRef = useRef<Page[]>(['dashboard']);
  const backRef = useRef<() => void>(() => {});

  const navigate = (p: string) => {
    const newPage = p as Page;
    if (newPage !== page) {
      historyRef.current.push(page);
      setPage(newPage);
    }
  };

  const goBack = () => {
    const hist = historyRef.current;
    if (hist.length > 1) {
      const prev = hist.pop()!;
      setPage(prev);
    } else {
      setPage('dashboard');
    }
  };

  useEdgeSwipeBack(() => backRef.current());

  if (loading && !booted) {
    return <BootSequence onComplete={() => setBooted(true)} />;
  }

  if (window.location.pathname === '/reset-password') {
    return <PasswordResetPage />;
  }

  if (!user) {
    return <AuthPage />;
  }

  if (!booted) {
    return <BootSequence onComplete={() => setBooted(true)} />;
  }

  return (
    <AppShell currentPage={page} onNavigate={navigate}>
      {page === 'dashboard' && <Dashboard onNavigate={navigate} />}
      {(page === 'all' || page === 'video' || page === 'photo' || page === 'document' || page === 'other' ||
        page === 'favorites' || page === 'recent' || page === 'trash') && (
        <FileBrowser category={page} onNavigate={navigate} onGoBack={goBack} backRef={backRef} />
      )}
      {page === 'settings' && <Settings onNavigate={navigate} />}
    </AppShell>
  );
}

export default function App() {
  if (!isSupabaseConfigured) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#050608] px-6 text-gray-200">
        <section className="w-full max-w-xl rounded-xl border border-cyber-green/20 bg-[#0b0e12] p-8 shadow-2xl">
          <p className="terminal-text text-cyber-green">AM0SP PRIVATE VAULT / BACKEND SETUP</p>
          <h1 className="mt-4 text-2xl font-semibold text-white">Connect the new Supabase project</h1>
          <p className="mt-3 text-sm leading-6 text-gray-400">
            The customer app is ready to use Supabase for accounts, files, and private storage. No demo data or
            former project credentials are used.
          </p>
          <p className="mt-5 rounded-lg border border-white/10 bg-black/30 p-4 font-mono text-xs leading-6 text-gray-300">
            Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the workspace environment, then restart the
            app. See SUPABASE_SETUP.md for database and Edge Function setup.
          </p>
        </section>
      </main>
    );
  }

  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
