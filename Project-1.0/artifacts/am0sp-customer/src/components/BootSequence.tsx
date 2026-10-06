import { useEffect, useState } from 'react';

interface BootSequenceProps {
  onComplete: () => void;
}

const BOOT_LINES = [
  'AM0SP SYSTEM',
  'INITIALIZING PRIVATE VAULT…',
  'SECURE CONNECTION…',
  'AUTHENTICATION SYSTEM READY…',
  'ENCRYPTED STORAGE ONLINE…',
  'VAULT ONLINE',
];

export function BootSequence({ onComplete }: BootSequenceProps) {
  const [visibleLines, setVisibleLines] = useState<number>(0);
  const [showProgress, setShowProgress] = useState(false);
  const [progress, setProgress] = useState(0);
  const [fadingOut, setFadingOut] = useState(false);

  useEffect(() => {
    if (visibleLines < BOOT_LINES.length) {
      const timer = setTimeout(() => {
        setVisibleLines((prev) => prev + 1);
      }, visibleLines === 0 ? 300 : 450);
      return () => clearTimeout(timer);
    } else {
      setShowProgress(true);
      return undefined;
    }
  }, [visibleLines]);

  useEffect(() => {
    if (!showProgress) return;
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setTimeout(() => setFadingOut(true), 300);
          setTimeout(onComplete, 800);
          return 100;
        }
        return prev + 4;
      });
    }, 30);
    return () => clearInterval(interval);
  }, [showProgress, onComplete]);

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center grid-bg transition-opacity duration-500 ${
        fadingOut ? 'opacity-0' : 'opacity-100'
      }`}
      style={{ background: 'radial-gradient(circle at 50% 30%, rgba(0,255,156,0.06), transparent 50%), #020304' }}
    >
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-0 right-0 h-px bg-cyber-green/30 animate-scan-line" />
        <div className="absolute bottom-0 left-0 right-0 h-px bg-cyber-green/15 animate-scan-line" style={{ animationDelay: '2s' }} />
      </div>

      <div className="relative z-10 w-full max-w-lg px-6">
        <div className="mb-10 text-center">
          <div className="inline-flex items-center justify-center mb-5 relative">
            <div className="absolute w-20 h-20 rounded-full border border-cyber-green/15 animate-pulse-slow" />
            <Am0spLogo size={64} />
          </div>
          <div className="terminal-text text-glow tracking-[0.3em] text-cyber-green text-sm">
            AM0SP // PRIVATE VAULT
          </div>
          <div className="cyber-section-label mt-2">SECURE BOOT SEQUENCE</div>
        </div>

        <div className="space-y-1 min-h-[200px]">
          {BOOT_LINES.slice(0, visibleLines).map((line, i) => {
            const isLast = i === BOOT_LINES.length - 1;
            return (
              <div
                key={i}
                className={`terminal-text animate-fade-in ${
                  isLast ? 'text-cyber-green text-glow font-bold' : ''
                }`}
              >
                <span className="text-cyber-green/40">{'>'}</span> {line}
                {isLast && <span className="cursor-blink" />}
              </div>
            );
          })}
        </div>

        {showProgress && (
          <div className="mt-6 animate-fade-in">
            <div className="flex justify-between terminal-text mb-1">
              <span>LOADING VAULT</span>
              <span>{progress}%</span>
            </div>
            <div className="h-1.5 bg-vault-900 rounded-full overflow-hidden border border-cyber-green/10">
              <div
                className="h-full bg-gradient-to-r from-cyber-green-dim to-cyber-green transition-all duration-75"
                style={{ width: `${progress}%`, boxShadow: '0 0 12px rgba(0,255,156,0.6)' }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function Am0spLogo({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="text-cyber-green"
    >
      <rect x="8" y="8" width="48" height="48" rx="6" stroke="currentColor" strokeWidth="2" opacity="0.3" />
      <rect x="14" y="14" width="36" height="36" rx="3" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
      <path
        d="M20 40 L20 28 L26 34 L32 28 L32 40"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M38 28 L38 40 L44 34 L44 40"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="32" cy="32" r="30" stroke="currentColor" strokeWidth="0.5" opacity="0.15" strokeDasharray="2 4" />
    </svg>
  );
}
