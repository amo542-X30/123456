import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { recordDeviceLogin, logSecurityEvent } from '@/lib/securityService';
import { getDeviceName } from '@/lib/utils';
import { checkRateLimit, resetRateLimit } from '@/lib/rateLimiter';

function getResetRedirectUrl(): string {
  if (typeof window === 'undefined') {
    throw new Error('Password reset is only available in the customer web app.');
  }
  return new URL('/reset-password', window.location.origin).toString();
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
  updateProfile: (displayName: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      (async () => {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);

        if (event === 'SIGNED_IN' && session?.user) {
          try {
            await recordDeviceLogin(session.access_token);
            await logSecurityEvent('login', `Login from ${getDeviceName()}`, getDeviceName());
          } catch {
            // Non-blocking — login still succeeds
          }
        }

        if (event === 'SIGNED_OUT') {
          setSession(null);
          setUser(null);
        }
      })();
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const rl = checkRateLimit(`login:${email}`);
    if (!rl.allowed) {
      throw new Error(`Too many attempts. Please wait ${Math.ceil(rl.retryAfterMs / 1000)} seconds.`);
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    resetRateLimit(`login:${email}`);
  };

  const signUp = async (email: string, password: string) => {
    const rl = checkRateLimit(`signup:${email}`);
    if (!rl.allowed) {
      throw new Error(`Too many attempts. Please wait ${Math.ceil(rl.retryAfterMs / 1000)} seconds.`);
    }
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    resetRateLimit(`signup:${email}`);
  };

  const signOut = async () => {
    if (user) {
      try {
        await logSecurityEvent('logout', `Logout from ${getDeviceName()}`, getDeviceName());
      } catch {
        // Non-blocking
      }
    }
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  const resetPassword = async (email: string) => {
    const rl = checkRateLimit(`reset:${email}`);
    if (!rl.allowed) {
      throw new Error(`Too many attempts. Please wait ${Math.ceil(rl.retryAfterMs / 1000)} seconds.`);
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: getResetRedirectUrl(),
    });
    if (error) throw error;
    resetRateLimit(`reset:${email}`);
  };

  const updatePassword = async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
  };

  const updateProfile = async (displayName: string) => {
    const trimmedName = displayName.trim();
    if (trimmedName.length > 80) throw new Error('Display name is too long');
    const { data, error } = await supabase.auth.updateUser({
      data: { display_name: trimmedName },
    });
    if (error) throw error;
    setUser(data.user);
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signUp, signOut, resetPassword, updatePassword, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
