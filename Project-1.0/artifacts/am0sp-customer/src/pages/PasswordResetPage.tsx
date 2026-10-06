import { useState, type FormEvent } from 'react';
import { ArrowLeft, Lock } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export function PasswordResetPage() {
  const { user, updatePassword } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSaving(true);
    try {
      await updatePassword(password);
      setUpdated(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update your password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#050608] px-4 py-8 text-gray-200">
      <section className="glass-panel cyber-frame w-full max-w-md p-6 sm:p-8">
        <p className="terminal-text text-cyber-green">AM0SP PRIVATE VAULT / ACCOUNT RECOVERY</p>
        <h1 className="mt-4 text-xl font-semibold text-white">
          {updated ? 'Password updated' : user ? 'Set a new password' : 'Recovery link unavailable'}
        </h1>

        {error && (
          <p role="alert" className="mt-4 rounded-lg border border-cyber-red/30 bg-cyber-red/10 px-4 py-3 text-sm text-cyber-red">
            {error}
          </p>
        )}

        {updated ? (
          <div className="mt-5 space-y-4">
            <p className="text-sm leading-6 text-gray-400">Your password has been changed.</p>
            <button type="button" onClick={() => window.location.assign('/')} className="btn-primary w-full">
              CONTINUE TO VAULT
            </button>
          </div>
        ) : user ? (
          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <label className="block">
              <span className="terminal-text mb-1.5 block">NEW PASSWORD</span>
              <span className="relative block">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyber-gray-text" />
                <input
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="input-field pl-10"
                />
              </span>
            </label>
            <label className="block">
              <span className="terminal-text mb-1.5 block">CONFIRM NEW PASSWORD</span>
              <span className="relative block">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyber-gray-text" />
                <input
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="input-field pl-10"
                />
              </span>
            </label>
            <button type="submit" disabled={saving} className="btn-primary w-full">
              {saving ? 'UPDATING…' : 'UPDATE PASSWORD'}
            </button>
          </form>
        ) : (
          <div className="mt-5 space-y-4">
            <p className="text-sm leading-6 text-gray-400">
              This password recovery link is invalid or expired. Return to sign in and request a new one.
            </p>
            <button type="button" onClick={() => window.location.assign('/')} className="btn-secondary inline-flex items-center gap-2">
              <ArrowLeft className="h-4 w-4" /> BACK TO LOGIN
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
