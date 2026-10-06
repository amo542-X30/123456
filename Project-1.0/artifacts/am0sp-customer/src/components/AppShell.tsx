import { useState, type ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Am0spLogo } from '@/components/BootSequence';
import { ParticleBackground } from '@/components/ParticleBackground';
import {
  LayoutDashboard, Folder, FileVideo, Image, FileText, Box,
  Star, Clock, Trash2, Settings as SettingsIcon, LogOut, Menu, X,
} from 'lucide-react';

interface AppShellProps {
  currentPage: string;
  onNavigate: (page: string) => void;
  children: ReactNode;
}

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'all', label: 'All Files', icon: Folder },
  { key: 'video', label: 'Videos', icon: FileVideo },
  { key: 'photo', label: 'Photos', icon: Image },
  { key: 'document', label: 'Documents', icon: FileText },
  { key: 'other', label: 'Other Files', icon: Box },
  { key: 'favorites', label: 'Favorites', icon: Star },
  { key: 'recent', label: 'Recent', icon: Clock },
  { key: 'trash', label: 'Trash', icon: Trash2 },
  { key: 'settings', label: 'Settings', icon: SettingsIcon },
];

export function AppShell({ currentPage, onNavigate, children }: AppShellProps) {
  const { user, signOut } = useAuth();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const handleNav = (page: string) => {
    onNavigate(page);
    setMobileNavOpen(false);
  };

  return (
    <div className="min-h-screen flex bg-vault-black relative overflow-hidden">
      <ParticleBackground />

      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-64 border-r border-cyber-green/10 bg-vault-black/75 backdrop-blur-xl relative z-10">
        <div className="p-5 border-b border-cyber-green/10">
          <div className="flex items-center gap-2">
            <Am0spLogo size={28} />
            <div>
              <div className="text-sm font-bold cyber-text tracking-[0.18em]">AM0SP</div>
              <div className="cyber-section-label mt-0.5">PRIVATE VAULT</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              onClick={() => handleNav(item.key)}
              className={`nav-item w-full ${currentPage === item.key ? 'nav-item-active' : ''}`}
            >
              <item.icon className="w-4 h-4" />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-cyber-green/10">
          <div className="px-3 py-2.5 mb-2 rounded-xl bg-cyber-green/[0.03] border border-cyber-green/10">
            <div className="text-xs text-gray-300 truncate">{user?.email}</div>
            <div className="terminal-text mt-1">NODE: AM0SP-01 · ONLINE</div>
          </div>
          <button onClick={signOut} className="nav-item w-full text-cyber-red hover:text-cyber-red/80">
            <LogOut className="w-4 h-4" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-30 bg-vault-black/95 backdrop-blur-xl border-b border-cyber-green/15 safe-top">
        <div className="flex items-center justify-between px-4 h-16">
          <div className="flex items-center gap-2.5">
            <Am0spLogo size={26} />
            <div>
              <span className="text-sm font-bold cyber-text tracking-[0.18em] block leading-tight">AM0SP</span>
              <span className="cyber-section-label">NODE_01 · ONLINE</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-cyber-green shadow-[0_0_8px_rgba(0,255,156,0.8)] animate-pulse-slow" />
            <button
              onClick={() => setMobileNavOpen(!mobileNavOpen)}
              className="p-2 rounded-xl border border-vault-600/70 hover:border-cyber-green/30 hover:bg-cyber-green/5 transition-colors"
            >
              {mobileNavOpen ? <X className="w-5 h-5 text-gray-300" /> : <Menu className="w-5 h-5 text-gray-300" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Nav Drawer */}
      {mobileNavOpen && (
        <div className="lg:hidden fixed inset-0 z-20 animate-fade-in" onClick={() => setMobileNavOpen(false)}>
          <div className="absolute inset-0 bg-vault-black/80 backdrop-blur-sm" />
          <div
            className="absolute top-16 left-0 right-0 bg-vault-black/97 border-b border-cyber-green/15 max-h-[80vh] overflow-y-auto"
            style={{ boxShadow: '0 20px 40px rgba(0,0,0,0.4)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <nav className="mobile-nav-orbit">
              <div className="mobile-nav-core">
                <Am0spLogo size={32} />
                <span>NODE 01</span>
              </div>
              <div className="mobile-nav-grid">
                {NAV_ITEMS.map((item) => (
                  <button
                    key={item.key}
                    onClick={() => handleNav(item.key)}
                    className={`mobile-nav-node ${currentPage === item.key ? 'mobile-nav-node-active' : ''}`}
                  >
                    <item.icon className="h-5 w-5" />
                    <span>{item.label}</span>
                  </button>
                ))}
                <button onClick={signOut} className="mobile-nav-node mobile-nav-node-danger">
                  <LogOut className="h-5 w-5" />
                  <span>Logout</span>
                </button>
              </div>
            </nav>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 relative z-10 overflow-y-auto pt-16 lg:pt-0 safe-bottom">
        <div className="max-w-6xl mx-auto p-4 lg:p-10">
          {children}
        </div>
      </main>
    </div>
  );
}
