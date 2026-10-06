import { useEffect, useState } from 'react';
import { getStorageStats } from '@/lib/fileService';
import { formatBytes } from '@/lib/utils';
import { Am0spLogo } from '@/components/BootSequence';
import { useAuth } from '@/context/AuthContext';
import { Folder, FileVideo, Image, FileText, Box, Star, HardDrive, ChevronDown, UserCircle, X, Save } from 'lucide-react';
import type { StorageStats } from '@/lib/types';

interface DashboardProps {
  onNavigate: (page: string) => void;
}

export function Dashboard({ onNavigate }: DashboardProps) {
  const { user, updateProfile } = useAuth();
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [storageExpanded, setStorageExpanded] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileName, setProfileName] = useState(String(user?.user_metadata?.display_name || ''));
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);

  useEffect(() => {
    getStorageStats()
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const usedBytes = stats?.totalBytes || 0;
  const categories = [
    { key: 'all', label: 'All Files', icon: Folder, count: stats?.totalFiles || 0 },
    { key: 'video', label: 'Videos', icon: FileVideo, count: stats?.videoCount || 0 },
    { key: 'photo', label: 'Photos', icon: Image, count: stats?.photoCount || 0 },
    { key: 'document', label: 'Documents', icon: FileText, count: stats?.documentCount || 0 },
    { key: 'other', label: 'Other Files', icon: Box, count: stats?.otherCount || 0 },
    { key: 'favorites', label: 'Favorites', icon: Star, count: null },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="cyber-frame flex items-center justify-between gap-4 rounded-2xl border border-cyber-green/15 bg-vault-900/60 px-5 py-4">
        <div className="flex items-center gap-3">
          <Am0spLogo size={32} />
          <div>
            <div className="cyber-section-label mb-1">AM0SP // NODE_01</div>
            <h1 className="text-xl font-bold cyber-text tracking-[0.14em]">PRIVATE VAULT</h1>
            <p className="terminal-text mt-1">{user?.email}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-2 terminal-text">
            <span className="w-2 h-2 rounded-full bg-cyber-green shadow-[0_0_10px_rgba(0,255,156,0.8)]" />
            CONNECTED
          </div>
          <button
            onClick={() => { setProfileMessage(null); setProfileOpen(true); }}
            className="flex items-center gap-2 rounded-xl border border-cyber-green/20 bg-cyber-green/[0.04] px-2.5 py-2 text-left transition-colors hover:border-cyber-green/50 hover:bg-cyber-green/10"
            aria-label="Open account profile"
          >
            <UserCircle className="h-5 w-5 text-cyber-green" />
            <span className="hidden md:block font-mono text-[10px] text-cyber-green/70">ACCOUNT</span>
          </button>
        </div>
      </div>

      <section className="holo-screen" aria-label="Holographic vault control panel">
        <div className="holo-screen-top">
          <div>
            <span className="holo-kicker">AM0SP // PRIVATE STORAGE</span>
            <h2>HOLO VAULT</h2>
          </div>
          <div className="holo-signal"><span /> LIVE DATA</div>
        </div>

        <div className="holo-screen-body holo-vault-body">
          <div className="holo-data-column">
            <div className="holo-panel-label">OPEN MODULE</div>
            <div className="holo-module-list">
              {categories.map((category) => (
                <button key={category.key} onClick={() => onNavigate(category.key)} className="holo-module-button">
                  <span className="holo-module-icon"><category.icon /></span>
                  <span>{category.label}</span>
                  {category.count !== null && <b>{category.count}</b>}
                </button>
              ))}
            </div>
          </div>

          <div className="holo-core" aria-hidden="true">
            <div className="holo-core-glow" />
            <div className="holo-ring holo-ring-outer" />
            <div className="holo-ring holo-ring-middle" />
            <div className="holo-ring holo-ring-inner" />
            <div className="holo-core-orb"><Am0spLogo size={42} /></div>
            <div className="holo-scan-line" />
          </div>

          <div className="holo-control-column">
            <div className="holo-panel-label">STORAGE</div>
            <button onClick={() => setStorageExpanded((expanded) => !expanded)} className="holo-storage-toggle">
              <span className="holo-storage-icon"><HardDrive /></span>
              <span>
                <strong>{loading ? '—' : formatBytes(usedBytes)}</strong>
                <small>{stats?.totalFiles || 0} files stored</small>
              </span>
              <ChevronDown className={`holo-chevron ${storageExpanded ? 'rotate-180' : ''}`} />
            </button>

            {storageExpanded && (
              <div className="holo-storage-details">
                <div><span>Used space</span><b>{formatBytes(usedBytes)}</b></div>
                <div><span>Total files</span><b>{stats?.totalFiles || 0}</b></div>
                <div><span>Provider</span><b>Supabase Storage</b></div>
                <div><span>Bucket</span><b>am0sp-vault</b></div>
                <div><span>Quota</span><b>No published cap</b></div>
              </div>
            )}

            {!storageExpanded && (
              <div className="holo-category-summary">
                {[
                  ['Videos', stats?.videoBytes || 0],
                  ['Photos', stats?.photoBytes || 0],
                  ['Documents', stats?.documentBytes || 0],
                ].map(([label, bytes]) => (
                  <div key={String(label)}><span>{label}</span><b>{formatBytes(Number(bytes))}</b></div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="holo-screen-footer">
          <span className="holo-activity"><i /> SELECT A MODULE TO CONTINUE</span>
          <span className="holo-footer-user">{user?.email}</span>
        </div>
      </section>

      {profileOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 pt-24 backdrop-blur-sm" onClick={() => setProfileOpen(false)}>
          <div className="glass-panel cyber-frame w-full max-w-md p-5" onClick={(event) => event.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between">
              <div>
                <div className="cyber-section-label">ACCOUNT // PROFILE</div>
                <h2 className="mt-1 text-sm font-bold tracking-[0.14em] text-gray-200">PROFILE SETTINGS</h2>
              </div>
              <button onClick={() => setProfileOpen(false)} className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-cyber-green/10 hover:text-cyber-green" aria-label="Close profile">
                <X className="h-4 w-4" />
              </button>
            </div>
            {profileMessage && <div className="mb-4 rounded-lg border border-cyber-green/30 bg-cyber-green/10 px-3 py-2 text-xs text-cyber-green">{profileMessage}</div>}
            <label className="terminal-text mb-1.5 block">DISPLAY NAME</label>
            <input
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
              className="input-field"
              placeholder="Your display name"
              maxLength={80}
              autoFocus
            />
            <label className="terminal-text mb-1.5 mt-4 block">EMAIL</label>
            <div className="rounded-lg border border-vault-600 bg-vault-900 px-4 py-3 text-sm text-gray-400">{user?.email}</div>
            <button
              onClick={async () => {
                setProfileSaving(true);
                setProfileMessage(null);
                try {
                  await updateProfile(profileName);
                  setProfileMessage('Profile saved');
                } catch (error) {
                  setProfileMessage(error instanceof Error ? error.message : 'Could not save profile');
                } finally {
                  setProfileSaving(false);
                }
              }}
              disabled={profileSaving}
              className="btn-primary mt-5 flex w-full items-center justify-center gap-2"
            >
              <Save className="h-4 w-4" /> {profileSaving ? 'SAVING…' : 'SAVE PROFILE'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
