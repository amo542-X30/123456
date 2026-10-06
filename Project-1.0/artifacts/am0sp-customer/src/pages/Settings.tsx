import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { STORAGE_BUCKET } from '@/lib/supabase';
import { getStorageStats } from '@/lib/fileService';
import { getDevices, revokeDevice, revokeAllOtherDevices, getSecurityEvents, logSecurityEvent } from '@/lib/securityService';
import { getPasskeys, registerPasskey, removePasskey, isWebAuthnSupported, isPlatformAuthenticatorAvailable, getUserSettings, updateUserSettings } from '@/lib/passkeyService';
import { restoreFile, permanentDeleteFile, emptyTrash, getFiles } from '@/lib/fileService';
import { formatBytes, formatDateTime, timeAgo } from '@/lib/utils';
import type { Device, SecurityEvent, Passkey, UserSettings, FileItem, StorageStats } from '@/lib/types';
import {
  User, Shield, HardDrive, Palette, LogOut, Trash2, Monitor, Fingerprint,
  KeyRound, Bell, Eye, EyeOff, Smartphone, AlertTriangle, RotateCcw,
} from 'lucide-react';

type SettingsTab = 'account' | 'security' | 'storage' | 'appearance';

interface SettingsProps {
  onNavigate: (page: string) => void;
}

export function Settings({ onNavigate }: SettingsProps) {
  const { user, signOut, updatePassword } = useAuth();
  const [tab, setTab] = useState<SettingsTab>('account');

  const tabs: { key: SettingsTab; label: string; icon: typeof User }[] = [
    { key: 'account', label: 'Account', icon: User },
    { key: 'security', label: 'Security', icon: Shield },
    { key: 'storage', label: 'Storage', icon: HardDrive },
    { key: 'appearance', label: 'Appearance', icon: Palette },
  ];

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center gap-3">
        <button onClick={() => onNavigate('dashboard')} className="p-2 rounded-xl border border-vault-600/60 hover:border-cyber-green/30 hover:bg-cyber-green/5 transition-colors">
          <span className="text-gray-400 text-sm">←</span>
        </button>
        <div>
          <div className="cyber-section-label mb-0.5">CONFIGURATION</div>
          <h1 className="text-lg font-bold cyber-text tracking-[0.14em]">SETTINGS</h1>
        </div>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium transition-all whitespace-nowrap ${
              tab === t.key
                ? 'bg-cyber-green/10 border border-cyber-green/30 text-cyber-green shadow-[0_0_12px_rgba(0,255,156,0.06)]'
                : 'text-gray-400 hover:text-gray-200 hover:bg-vault-700/50 border border-transparent'
            }`}
          >
            <t.icon className="w-3.5 h-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'account' && <AccountTab email={user?.email || ''} onLogout={signOut} onUpdatePassword={updatePassword} />}
      {tab === 'security' && <SecurityTab />}
      {tab === 'storage' && <StorageTab />}
      {tab === 'appearance' && <AppearanceTab />}
    </div>
  );
}

function AccountTab({ email, onLogout, onUpdatePassword }: {
  email: string;
  onLogout: () => Promise<void>;
  onUpdatePassword: (pw: string) => Promise<void>;
}) {
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const handlePasswordChange = async () => {
    if (newPassword.length < 8) {
      setMsg({ type: 'error', text: 'Password must be at least 8 characters' });
      return;
    }
    setLoading(true);
    try {
      await onUpdatePassword(newPassword);
      await logSecurityEvent('password_change', 'Password was changed');
      setMsg({ type: 'success', text: 'Password updated successfully' });
      setNewPassword('');
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to update password' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="glass-panel p-5">
        <div className="flex items-center gap-2 mb-4">
          <User className="w-4 h-4 text-cyber-green" />
          <h2 className="text-sm font-bold text-gray-200">ACCOUNT</h2>
        </div>
        <div className="space-y-3">
          <div>
            <label className="terminal-text block mb-1">EMAIL</label>
            <div className="px-4 py-3 rounded-lg bg-vault-900 border border-vault-600 text-sm text-gray-300">
              {email}
            </div>
          </div>
        </div>
      </div>

      <div className="glass-panel p-5">
        <div className="flex items-center gap-2 mb-4">
          <KeyRound className="w-4 h-4 text-cyber-green" />
          <h2 className="text-sm font-bold text-gray-200">CHANGE PASSWORD</h2>
        </div>
        {msg && (
          <div className={`mb-3 px-3 py-2 rounded-lg text-xs ${
            msg.type === 'success'
              ? 'bg-cyber-green/10 border border-cyber-green/30 text-cyber-green'
              : 'bg-cyber-red/10 border border-cyber-red/30 text-cyber-red'
          }`}>
            {msg.text}
          </div>
        )}
        <div className="relative mb-3">
          <input
            type={showPassword ? 'text' : 'password'}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password"
            className="input-field pr-10"
          />
          <button
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2"
          >
            {showPassword ? <EyeOff className="w-4 h-4 text-cyber-gray-text" /> : <Eye className="w-4 h-4 text-cyber-gray-text" />}
          </button>
        </div>
        <button onClick={handlePasswordChange} disabled={loading || !newPassword} className="btn-primary">
          {loading ? 'UPDATING…' : 'UPDATE PASSWORD'}
        </button>
      </div>

      <div className="glass-panel p-5">
        <button onClick={onLogout} className="btn-danger w-full flex items-center justify-center gap-2">
          <LogOut className="w-4 h-4" /> LOGOUT
        </button>
      </div>
    </div>
  );
}

function SecurityTab() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [webAuthnSupported, setWebAuthnSupported] = useState(false);
  const [platformAuth, setPlatformAuth] = useState(false);
  const [loading, setLoading] = useState(true);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadSecurity = async () => {
    setLoading(true);
    try {
      const [d, e, p] = await Promise.all([getDevices(), getSecurityEvents(), getPasskeys()]);
      setDevices(d);
      setEvents(e);
      setPasskeys(p);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setWebAuthnSupported(isWebAuthnSupported());
    isPlatformAuthenticatorAvailable().then(setPlatformAuth);
    loadSecurity();
  }, []);

  const handleRegisterPasskey = async () => {
    setPasskeyLoading(true);
    setMsg(null);
    try {
      await registerPasskey();
      await logSecurityEvent('passkey_registered', 'A new passkey was registered');
      setMsg({ type: 'success', text: 'Passkey registered successfully' });
      loadSecurity();
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to register passkey' });
    } finally {
      setPasskeyLoading(false);
    }
  };

  const handleRemovePasskey = async (id: string) => {
    if (!confirm('Remove this passkey?')) return;
    try {
      await removePasskey(id);
      await logSecurityEvent('passkey_removed', 'A passkey was removed');
      loadSecurity();
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to remove passkey' });
    }
  };

  const handleRevokeDevice = async (id: string) => {
    if (!confirm('Revoke this device session?')) return;
    try {
      await revokeDevice(id);
      loadSecurity();
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to revoke device' });
    }
  };

  const handleRevokeAll = async () => {
    if (!confirm('Logout ALL other devices?')) return;
    try {
      await revokeAllOtherDevices();
      loadSecurity();
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to revoke devices' });
    }
  };

  return (
    <div className="space-y-4">
      {msg && (
        <div className={`px-3 py-2 rounded-lg text-xs ${
          msg.type === 'success'
            ? 'bg-cyber-green/10 border border-cyber-green/30 text-cyber-green'
            : 'bg-cyber-red/10 border border-cyber-red/30 text-cyber-red'
        }`}>
          {msg.text}
        </div>
      )}

      {/* Passkey Section */}
      <div className="glass-panel p-5">
        <div className="flex items-center gap-2 mb-4">
          <Fingerprint className="w-4 h-4 text-cyber-green" />
          <h2 className="text-sm font-bold text-gray-200">PASSKEY / FACE ID / FINGERPRINT</h2>
        </div>

        {!webAuthnSupported ? (
          <div className="p-3 rounded-lg bg-vault-900/50 border border-vault-600/30">
            <p className="text-xs text-cyber-gray-text flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-cyber-amber" />
              WebAuthn is not supported on this browser/device. Passkey authentication is not available.
            </p>
          </div>
        ) : !platformAuth ? (
          <div className="p-3 rounded-lg bg-vault-900/50 border border-vault-600/30">
            <p className="text-xs text-cyber-gray-text">
              WebAuthn is supported but no biometric platform authenticator (Face ID / Fingerprint) was detected on this device.
            </p>
          </div>
        ) : (
          <>
            <button onClick={handleRegisterPasskey} disabled={passkeyLoading} className="btn-primary mb-4 flex items-center gap-2">
              <Fingerprint className="w-4 h-4" />
              {passkeyLoading ? 'REGISTERING…' : 'ENABLE PASSKEY'}
            </button>

            {passkeys.length > 0 && (
              <div className="space-y-2">
                <p className="terminal-text">REGISTERED PASSKEYS</p>
                {passkeys.map((pk) => (
                  <div key={pk.id} className="flex items-center justify-between p-3 rounded-lg bg-vault-900/50 border border-vault-600/30">
                    <div className="flex items-center gap-2">
                      <Smartphone className="w-4 h-4 text-cyber-green" />
                      <div>
                        <div className="text-xs text-gray-300">{pk.device_name || 'Unknown device'}</div>
                        <div className="terminal-text">{timeAgo(pk.created_at)}</div>
                      </div>
                    </div>
                    <button onClick={() => handleRemovePasskey(pk.id)} className="text-cyber-red hover:text-cyber-red/80 p-1">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Devices Section */}
      <div className="glass-panel p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Monitor className="w-4 h-4 text-cyber-green" />
            <h2 className="text-sm font-bold text-gray-200">ACTIVE DEVICES</h2>
          </div>
          {devices.length > 1 && (
            <button onClick={handleRevokeAll} className="btn-danger !py-1.5 !px-3 text-xs">
              Logout All Others
            </button>
          )}
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-16 bg-vault-900/50 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : devices.length === 0 ? (
          <p className="terminal-text">No device sessions recorded</p>
        ) : (
          <div className="space-y-2">
            {devices.map((d) => (
              <div key={d.id} className="flex items-center justify-between p-3 rounded-lg bg-vault-900/50 border border-vault-600/30">
                <div className="flex items-center gap-3 min-w-0">
                  <Monitor className="w-4 h-4 text-cyber-green flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs text-gray-300 truncate">
                      {d.device_name || 'Unknown'}
                    </div>
                    <div className="terminal-text">
                      {formatDateTime(d.login_at)} · {timeAgo(d.last_active_at)}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => handleRevokeDevice(d.id)}
                  className="text-cyber-red hover:text-cyber-red/80 p-1 flex-shrink-0"
                  title="Revoke session"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="terminal-text mt-3 leading-relaxed">
          Note: Remote logout removes the device record. Full session invalidation requires Supabase token revocation via the admin API in production.
        </p>
      </div>

      {/* Security Events */}
      <div className="glass-panel p-5">
        <div className="flex items-center gap-2 mb-4">
          <Bell className="w-4 h-4 text-cyber-green" />
          <h2 className="text-sm font-bold text-gray-200">SECURITY EVENTS</h2>
        </div>
        {events.length === 0 ? (
          <p className="terminal-text">No security events recorded</p>
        ) : (
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {events.map((e) => (
              <div key={e.id} className="flex items-start gap-2 p-2 rounded-lg bg-vault-900/30">
                <Shield className="w-3.5 h-3.5 text-cyber-green/60 mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs text-gray-300">{e.description}</div>
                  <div className="terminal-text">{formatDateTime(e.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StorageTab() {
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [trashFiles, setTrashFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [s, trashResult] = await Promise.all([
        getStorageStats(),
        getFiles(undefined, undefined, { trashOnly: true, pageSize: 100 }),
      ]);
      setStats(s);
      setTrashFiles(trashResult.files);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleRestore = async (file: FileItem) => {
    try {
      await restoreFile(file.id);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to restore');
    }
  };

  const handlePermanentDelete = async (file: FileItem) => {
    if (!confirm(`Permanently delete "${file.original_name}"? This cannot be undone.`)) return;
    try {
      await permanentDeleteFile(file);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const handleEmptyTrash = async () => {
    if (!confirm('Permanently delete ALL files in trash? This cannot be undone.')) return;
    try {
      await emptyTrash();
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to empty trash');
    }
  };

  return (
    <div className="space-y-4">
      <div className="glass-panel p-5">
        <div className="flex items-center gap-2 mb-4">
          <HardDrive className="w-4 h-4 text-cyber-green" />
          <h2 className="text-sm font-bold text-gray-200">STORAGE</h2>
        </div>
        {loading ? (
          <div className="animate-pulse space-y-3">
            <div className="h-6 bg-vault-700 rounded" />
            <div className="h-3 bg-vault-700 rounded" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="p-3 rounded-lg bg-vault-900/50 border border-vault-600/30">
                <div className="text-lg font-bold text-gray-100">{formatBytes(stats?.totalBytes || 0)}</div>
                <div className="terminal-text">USED</div>
              </div>
              <div className="p-3 rounded-lg bg-vault-900/50 border border-vault-600/30">
                <div className="text-lg font-bold text-gray-100">{stats?.totalFiles || 0}</div>
                <div className="terminal-text">TOTAL FILES</div>
              </div>
            </div>

            <div className="space-y-2">
              <StorageBar label="Videos" bytes={stats?.videoBytes || 0} total={stats?.totalBytes || 1} color="bg-red-400" />
              <StorageBar label="Photos" bytes={stats?.photoBytes || 0} total={stats?.totalBytes || 1} color="bg-blue-400" />
              <StorageBar label="Documents" bytes={stats?.documentBytes || 0} total={stats?.totalBytes || 1} color="bg-green-400" />
              <StorageBar label="Other" bytes={stats?.otherBytes || 0} total={stats?.totalBytes || 1} color="bg-amber-400" />
            </div>

            <div className="mt-4 p-3 rounded-lg bg-vault-900/50 border border-vault-600/30">
              <p className="terminal-text leading-relaxed">
                <span className="text-cyber-green/60">{'>'}</span> Provider: Supabase Storage (connected)
                <br />
                <span className="text-cyber-green/60">{'>'}</span> Bucket: {STORAGE_BUCKET} (private, RLS-enforced)
                <br />
                <span className="text-cyber-green/60">{'>'}</span> Max file size: 50MB per upload (Supabase plan limit — resumable uploads support larger files)
                <br />
                <span className="text-cyber-green/60">{'>'}</span> No fixed storage quota — actual usage shown above
                <br />
                <span className="text-cyber-green/60">{'>'}</span> Files persist across logout, browser close, and device changes
                <br />
                <span className="text-cyber-green/60">{'>'}</span> Downloads use signed URLs — original file quality preserved
              </p>
            </div>
          </>
        )}
      </div>

      {/* Trash Management */}
      <div className="glass-panel p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-cyber-green" />
            <h2 className="text-sm font-bold text-gray-200">TRASH</h2>
          </div>
          {trashFiles.length > 0 && (
            <button onClick={handleEmptyTrash} className="btn-danger !py-1.5 !px-3 text-xs">
              Empty Trash
            </button>
          )}
        </div>
        {trashFiles.length === 0 ? (
          <p className="terminal-text">Trash is empty</p>
        ) : (
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {trashFiles.map((f) => (
              <div key={f.id} className="flex items-center justify-between p-3 rounded-lg bg-vault-900/50 border border-vault-600/30">
                <div className="min-w-0">
                  <div className="text-xs text-gray-300 truncate">{f.original_name}</div>
                  <div className="terminal-text">{formatBytes(f.size_bytes)} · deleted {timeAgo(f.deleted_at || f.updated_at)}</div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => handleRestore(f)} className="p-1.5 text-cyber-green hover:text-cyber-green/80" title="Restore">
                    <RotateCcw className="w-4 h-4" />
                  </button>
                  <button onClick={() => handlePermanentDelete(f)} className="p-1.5 text-cyber-red hover:text-cyber-red/80" title="Delete permanently">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StorageBar({ label, bytes, total, color }: { label: string; bytes: number; total: number; color: string }) {
  const pct = total > 0 ? (bytes / total) * 100 : 0;
  return (
    <div>
      <div className="flex justify-between terminal-text mb-1">
        <span>{label}</span>
        <span>{formatBytes(bytes)}</span>
      </div>
      <div className="h-1.5 bg-vault-900 rounded-full overflow-hidden">
        <div className={`h-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function AppearanceTab() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getUserSettings().then(setSettings).finally(() => setLoading(false));
  }, []);

  const update = async (partial: Partial<UserSettings>) => {
    if (!settings) return;
    const updated = { ...settings, ...partial };
    setSettings(updated);
    try {
      await updateUserSettings(updated);
    } catch {
      // revert on error
      setSettings(settings);
    }
  };

  if (loading) return <div className="glass-panel p-5 animate-pulse h-40" />;

  return (
    <div className="glass-panel p-5 space-y-5">
      <div className="flex items-center gap-2 mb-2">
        <Palette className="w-4 h-4 text-cyber-green" />
        <h2 className="text-sm font-bold text-gray-200">APPEARANCE</h2>
      </div>

      <ToggleRow
        label="Terminal Effects"
        description="Show terminal-style boot sequence and system logs"
        value={settings?.terminal_effects ?? true}
        onChange={(v) => update({ terminal_effects: v })}
      />

      <div>
        <label className="text-sm text-gray-200 block mb-2">Animation Intensity</label>
        <div className="flex gap-2">
          {(['full', 'reduced', 'off'] as const).map((level) => (
            <button
              key={level}
              onClick={() => update({ animation_intensity: level })}
              className={`px-3 py-2 rounded-lg text-xs capitalize transition-all ${
                settings?.animation_intensity === level
                  ? 'bg-cyber-green/10 border border-cyber-green/30 text-cyber-green'
                  : 'bg-vault-900 border border-vault-600 text-gray-400 hover:text-gray-200'
              }`}
            >
              {level}
            </button>
          ))}
        </div>
      </div>

      <ToggleRow
        label="Reduced Motion"
        description="Minimize animations and transitions"
        value={settings?.reduced_motion ?? false}
        onChange={(v) => update({ reduced_motion: v })}
      />

      <div className="p-3 rounded-lg bg-vault-900/50 border border-vault-600/30">
        <p className="terminal-text leading-relaxed">
          <span className="text-cyber-green/60">{'>'}</span> Dark interface is always enabled (vault aesthetic)
          <br />
          <span className="text-cyber-green/60">{'>'}</span> Monospace typography for terminal feel
        </p>
      </div>
    </div>
  );
}

function ToggleRow({ label, description, value, onChange }: {
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="text-sm text-gray-200">{label}</div>
        <div className="terminal-text">{description}</div>
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`relative w-12 h-6 rounded-full transition-all ${
          value ? 'bg-cyber-green/30 border border-cyber-green/50' : 'bg-vault-700 border border-vault-500'
        }`}
      >
        <div
          className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${
            value ? 'left-7 bg-cyber-green' : 'left-0.5 bg-gray-400'
          }`}
        />
      </button>
    </div>
  );
}
