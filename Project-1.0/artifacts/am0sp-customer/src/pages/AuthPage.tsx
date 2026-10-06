import { useState, useEffect, type FormEvent } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Am0spLogo } from '@/components/BootSequence';
import { Fingerprint, Lock, Mail, ArrowLeft } from 'lucide-react';
import { isWebAuthnSupported, isPlatformAuthenticatorAvailable, authenticateWithPasskey } from '@/lib/passkeyService';

type Mode = 'login' | 'register' | 'forgot';

export function AuthPage({ initialMode = 'login' }: { initialMode?: Mode }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);

  const { signIn, signUp, resetPassword } = useAuth();

  useEffect(() => {
    (async () => {
      const supported = isWebAuthnSupported();
      if (supported) {
        const available = await isPlatformAuthenticatorAvailable();
        setPasskeyAvailable(available);
      }
    })();
  }, []);

  const handlePasskeyLogin = async () => {
    setError(null);
    setSuccess(null);
    setPasskeyLoading(true);
    try {
      await authenticateWithPasskey();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Biometric login failed');
    } finally {
      setPasskeyLoading(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      if (mode === 'login') {
        await signIn(email, password);
      } else if (mode === 'register') {
        if (password !== confirmPassword) {
          throw new Error('Passwords do not match');
        }
        if (password.length < 8) {
          throw new Error('Password must be at least 8 characters');
        }
        await signUp(email, password);
        setSuccess('Account created. You can now sign in.');
        setMode('login');
      } else if (mode === 'forgot') {
        await resetPassword(email);
        setSuccess('Password reset link sent to your email.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8 safe-top safe-bottom relative overflow-hidden">
      <div className="absolute inset-0 grid-bg opacity-50 pointer-events-none" />
      <div className="absolute left-1/2 top-1/2 w-[28rem] h-[28rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyber-green/[0.035] blur-3xl pointer-events-none" />

      <div className="relative z-10 w-full max-w-md">
        <div className="glass-panel cyber-frame cyber-glow p-6 sm:p-8 animate-slide-up">
          <div className="flex items-center justify-between mb-7 cyber-section-label">
            <span>SECURE GATEWAY</span>
            <span className="flex items-center gap-1.5"><i className="w-1.5 h-1.5 rounded-full bg-cyber-green" /> ONLINE</span>
          </div>
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center mb-3">
              <Am0spLogo size={48} />
            </div>
            <h1 className="text-lg font-bold cyber-text tracking-[0.2em]">AM0SP // PRIVATE VAULT</h1>
            <p className="terminal-text mt-1">
              {mode === 'login' && 'SECURE AUTHENTICATION'}
              {mode === 'register' && 'CREATE VAULT ACCOUNT'}
              {mode === 'forgot' && 'RESET ACCESS'}
            </p>
          </div>

          {error && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-cyber-red/10 border border-cyber-red/30 text-cyber-red text-xs animate-fade-in">
              {error}
            </div>
          )}
          {success && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-cyber-green/10 border border-cyber-green/30 text-cyber-green text-xs animate-fade-in">
              {success}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="terminal-text block mb-1.5">EMAIL</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cyber-gray-text" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-field pl-10"
                  placeholder="you@domain.com"
                  autoComplete="email"
                />
              </div>
            </div>

            {mode !== 'forgot' && (
              <div>
                <label className="terminal-text block mb-1.5">PASSWORD</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cyber-gray-text" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input-field pl-10"
                    placeholder="••••••••"
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  />
                </div>
              </div>
            )}

            {mode === 'register' && (
              <div>
                <label className="terminal-text block mb-1.5">CONFIRM PASSWORD</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cyber-gray-text" />
                  <input
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="input-field pl-10"
                    placeholder="••••••••"
                    autoComplete="new-password"
                  />
                </div>
              </div>
            )}

            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? 'PROCESSING…' : (
                <>
                  {mode === 'login' && 'LOGIN'}
                  {mode === 'register' && 'CREATE ACCOUNT'}
                  {mode === 'forgot' && 'SEND RESET LINK'}
                </>
              )}
            </button>
          </form>

          {mode === 'login' && passkeyAvailable && (
            <>
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-vault-600" />
                <span className="terminal-text">OR</span>
                <div className="flex-1 h-px bg-vault-600" />
              </div>
              <button
                onClick={handlePasskeyLogin}
                disabled={passkeyLoading}
                className="btn-secondary w-full flex items-center justify-center gap-2"
              >
                <Fingerprint className="w-4 h-4" />
                {passkeyLoading ? 'VERIFYING…' : 'CONTINUE WITH PASSKEY'}
              </button>
            </>
          )}

          <div className="mt-6 space-y-2 text-center">
            {mode === 'login' && (
              <>
                <button
                  onClick={() => { setMode('forgot'); setError(null); setSuccess(null); }}
                  className="text-xs text-cyber-gray-text hover:text-cyber-green transition-colors"
                >
                  Forgot Password?
                </button>
                <div className="text-xs text-cyber-gray-text">
                  No account?{' '}
                  <button
                    onClick={() => { setMode('register'); setError(null); setSuccess(null); }}
                    className="text-cyber-green hover:underline"
                  >
                    Create one
                  </button>
                </div>
              </>
            )}
            {mode === 'register' && (
              <button
                onClick={() => { setMode('login'); setError(null); setSuccess(null); }}
                className="text-xs text-cyber-gray-text hover:text-cyber-green transition-colors inline-flex items-center gap-1"
              >
                <ArrowLeft className="w-3 h-3" /> Back to login
              </button>
            )}
            {mode === 'forgot' && (
              <button
                onClick={() => { setMode('login'); setError(null); setSuccess(null); }}
                className="text-xs text-cyber-gray-text hover:text-cyber-green transition-colors inline-flex items-center gap-1"
              >
                <ArrowLeft className="w-3 h-3" /> Back to login
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-center gap-2 terminal-text">
          <span className="h-px w-8 bg-cyber-green/20" />
          AM0SP NETWORK · ENCRYPTED PRIVATE CLOUD
          <span className="h-px w-8 bg-cyber-green/20" />
        </div>
      </div>
    </div>
  );
}
