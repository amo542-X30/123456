import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Play, Pause, Volume2, VolumeX,
  Settings, Maximize, Minimize, PictureInPicture, Expand,
  ChevronUp, ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { loadSubtitleBlobUrl, type SubtitleTrack } from '@/lib/subtitleService';

interface SafariVideoElement extends HTMLVideoElement {
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
}

type OrientationScreen = Screen & {
  orientation: ScreenOrientation & { lock?: (orientation: string) => Promise<void> };
};

interface Am0spVideoPlayerProps {
  src: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  fileId: string;
  onError: () => void;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onAutoNext?: () => void;
  subtitleTracks?: SubtitleTrack[];
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function CyberVisionIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="20" height="20" viewBox="0 0 24 24" fill="none"
      className={cn('transition-all duration-300', active ? 'text-cyber-green' : 'text-white/50')}
      style={active ? { filter: 'drop-shadow(0 0 4px rgba(0,255,156,0.45))' } : undefined}
    >
      <path d="M12 2.5L20 7v10l-8 4.5L4 17V7l8-4.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" opacity={active ? 0.85 : 0.45} />
      <path d="M8.5 10L6.5 12l2 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" opacity={active ? 0.8 : 0.4} />
      <path d="M15.5 10L17.5 12l-2 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" opacity={active ? 0.8 : 0.4} />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" opacity={active ? 0.7 : 0.3} />
    </svg>
  );
}

/* Small circular arrow for double-tap seek feedback */
function SeekArrow({ dir }: { dir: 'left' | 'right' }) {
  return (
    <div className="flex items-center justify-center animate-fade-in">
      <div className="w-12 h-12 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {dir === 'left' ? (
            <>
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <path d="M3 4v5h5" />
            </>
          ) : (
            <>
              <path d="M21 12a9 9 0 1 1-3-6.7" />
              <path d="M21 4v5h-5" />
            </>
          )}
        </svg>
      </div>
    </div>
  );
}

export function Am0spVideoPlayer({ src, fileName, mimeType, fileId, onError, onSwipeLeft, onSwipeRight, onAutoNext, subtitleTracks = [] }: Am0spVideoPlayerProps) {
  const videoRef = useRef<SafariVideoElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const seekBarRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const singleTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTap = useRef<{ time: number; x: number }>({ time: 0, x: 0 });
  const touchStart = useRef<{ x: number; y: number; t: number }>({ x: 0, y: 0, t: 0 });
  const swiping = useRef(false);
  const draggingSeek = useRef(false);
  const isTouch = useRef(false);
  const touchHandled = useRef(false);
  const subtitleBlobRef = useRef<string | null>(null);

  const [activeSubtitleIdx, setActiveSubtitleIdx] = useState(-1);
  const [subtitleOffset, setSubtitleOffset] = useState(0);
  const [subtitleUrl, setSubtitleUrl] = useState<string | null>(null);
  const [subtitleLoading, setSubtitleLoading] = useState(false);

  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [showControls, setShowControls] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [cyberVision, setCyberVision] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [videoW, setVideoW] = useState(0);
  const [videoH, setVideoH] = useState(0);
  const [seekHint, setSeekHint] = useState<{ dir: 'left' | 'right' } | null>(null);
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [canPip, setCanPip] = useState(false);
  const [pipActive, setPipActive] = useState(false);

  /* ── Feature detection ── */
  useEffect(() => {
    const el = document.createElement('video');
    setCanFullscreen(
      typeof document !== 'undefined' &&
      (!!document.fullscreenEnabled || !!(el as SafariVideoElement).webkitEnterFullscreen)
    );
    setCanPip(typeof document !== 'undefined' && !!document.pictureInPictureEnabled);
  }, []);

  /* ── Reset on src change ── */
  useEffect(() => {
    setCurrentTime(0);
    setDuration(0);
    setBuffered(0);
    setWaiting(true);
    setShowControls(true);
    setActiveSubtitleIdx(-1);
    setSubtitleOffset(0);
  }, [src, fileId]);

  /* ── Auto-hide timer (4 seconds, only while playing) ── */
  const startHideTimer = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) {
        setShowControls(false);
        setShowSettings(false);
      }
    }, 4000);
  }, []);

  /* ── Reveal controls and start auto-hide timer ── */
  const reveal = useCallback(() => {
    setShowControls(true);
    startHideTimer();
  }, [startHideTimer]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
    reveal();
  }, [reveal]);

  const seekBy = useCallback((delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta));
    setCurrentTime(v.currentTime);
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    reveal();
  }, [reveal]);

  const setSpeed = useCallback((rate: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = rate;
    setPlaybackRate(rate);
  }, []);

  /* ── Rotate = Fullscreen + Landscape orientation (Telegram-style) ── */
  const enterFullscreenLandscape = useCallback(() => {
    const el = rootRef.current;
    const v = videoRef.current;
    if (!el && !v) return;

    if (!isFullscreen) {
      if (el?.requestFullscreen) {
        el.requestFullscreen().then(() => {
          const screen = window.screen as OrientationScreen;
          if (screen?.orientation?.lock) {
            screen.orientation.lock('landscape').catch(() => {});
          }
        }).catch(() => {
          setIsFullscreen(true);
        });
      } else if (v?.webkitEnterFullscreen) {
        v.webkitEnterFullscreen();
      } else {
        setIsFullscreen(true);
      }
    } else {
      const doc = document as Document & { webkitExitFullscreen?: () => void };
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if (doc.webkitExitFullscreen) {
        doc.webkitExitFullscreen();
      } else if (v?.webkitExitFullscreen) {
        v.webkitExitFullscreen();
      }
      setIsFullscreen(false);
      const screen = window.screen as OrientationScreen;
      if (screen?.orientation?.unlock) {
        screen.orientation.unlock();
      }
    }
    reveal();
  }, [reveal, isFullscreen]);

  /* ── Standard fullscreen toggle ── */
  const toggleFullscreen = useCallback(() => {
    const el = rootRef.current;
    const v = videoRef.current;
    if (!el && !v) return;
    if (!isFullscreen) {
      if (el?.requestFullscreen) {
        el.requestFullscreen().catch(() => { setIsFullscreen(true); });
      } else if (v?.webkitEnterFullscreen) {
        v.webkitEnterFullscreen();
      } else {
        setIsFullscreen(true);
      }
    } else {
      const doc = document as Document & { webkitExitFullscreen?: () => void };
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if (doc.webkitExitFullscreen) {
        doc.webkitExitFullscreen();
      } else if (v?.webkitExitFullscreen) {
        v.webkitExitFullscreen();
      }
      setIsFullscreen(false);
    }
    reveal();
  }, [reveal, isFullscreen]);

  /* ── PiP ── */
  const togglePip = useCallback(async () => {
    const v = videoRef.current;
    if (!v || !canPip) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await v.requestPictureInPicture();
      }
    } catch { /* ignore */ }
    reveal();
  }, [canPip, reveal]);

  /* ── Seek bar ── */
  const seekToX = useCallback((clientX: number) => {
    const v = videoRef.current;
    const bar = seekBarRef.current;
    if (!v || !bar || !duration) return;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    v.currentTime = pct * duration;
    setCurrentTime(v.currentTime);
  }, [duration]);

  const onSeekBarDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    draggingSeek.current = true;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* */ }
    seekToX(e.clientX);
  }, [seekToX]);

  const onSeekBarMove = useCallback((e: React.PointerEvent) => {
    if (draggingSeek.current) { e.stopPropagation(); seekToX(e.clientX); }
  }, [seekToX]);

  const onSeekBarUp = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    draggingSeek.current = false;
    reveal();
  }, [reveal]);

  /* ── Touch: tap, double-tap, swipe ── */
  const onStageTouchStart = useCallback((e: React.TouchEvent) => {
    isTouch.current = true;
    touchHandled.current = false;
    if (e.touches.length === 1) {
      const t = e.touches[0];
      touchStart.current = { x: t.clientX, y: t.clientY, t: Date.now() };
      swiping.current = false;
    }
  }, []);

  const onStageTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    if (Math.abs(dx) > 15 && Math.abs(dx) > Math.abs(dy)) {
      swiping.current = true;
    }
  }, []);

  const onStageTouchEnd = useCallback((e: React.TouchEvent) => {
    const t = e.changedTouches[0];
    const now = Date.now();
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    const dist = Math.hypot(dx, dy);
    const elapsed = now - touchStart.current.t;

    // Mark that touch handled this gesture so the subsequent click is suppressed
    touchHandled.current = true;

    // Swipe navigation — horizontal, > 60px, dominant horizontal
    if (swiping.current && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0 && onSwipeLeft) onSwipeLeft();
      else if (dx > 0 && onSwipeRight) onSwipeRight();
      lastTap.current = { time: 0, x: 0 };
      if (singleTapTimer.current) { clearTimeout(singleTapTimer.current); singleTapTimer.current = null; }
      return;
    }

    // Not a tap if moved too much or too slow
    if (dist > 12 || elapsed > 500) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const relX = (t.clientX - rect.left) / rect.width;

    // Double-tap detection
    if (now - lastTap.current.time < 300 && Math.abs(t.clientX - lastTap.current.x) < 50) {
      // Cancel any pending single-tap action
      if (singleTapTimer.current) { clearTimeout(singleTapTimer.current); singleTapTimer.current = null; }

      if (relX < 0.35) {
        seekBy(-10);
        setSeekHint({ dir: 'left' });
      } else if (relX > 0.65) {
        seekBy(10);
        setSeekHint({ dir: 'right' });
      } else {
        togglePlay();
      }
      lastTap.current = { time: 0, x: 0 };
      if (seekHintTimer.current) clearTimeout(seekHintTimer.current);
      seekHintTimer.current = setTimeout(() => setSeekHint(null), 600);
      return;
    }

    // Single tap — wait 280ms to see if double-tap follows
    lastTap.current = { time: now, x: t.clientX };
    if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
    singleTapTimer.current = setTimeout(() => {
      singleTapTimer.current = null;
      // Toggle: hidden→show+timer, visible→hide immediately
      setShowControls((currentlyVisible) => {
        if (currentlyVisible) {
          if (hideTimer.current) clearTimeout(hideTimer.current);
          setShowSettings(false);
          return false;
        } else {
          startHideTimer();
          return true;
        }
      });
    }, 280);
  }, [seekBy, togglePlay, startHideTimer, onSwipeLeft, onSwipeRight]);

  // Desktop click — same toggle behavior (suppressed if touch already handled)
  const onStageClick = useCallback(() => {
    if (touchHandled.current) { touchHandled.current = false; return; }
    if (isTouch.current) { isTouch.current = false; return; }
    setShowControls((currentlyVisible) => {
      if (currentlyVisible) {
        if (hideTimer.current) clearTimeout(hideTimer.current);
        setShowSettings(false);
        return false;
      } else {
        startHideTimer();
        return true;
      }
    });
  }, [startHideTimer]);

  /* ── Video events ── */
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => { if (!draggingSeek.current) setCurrentTime(v.currentTime); };
    const onDur = () => setDuration(v.duration || 0);
    const onMeta = () => {
      setDuration(v.duration || 0);
      setVolume(v.volume);
      setVideoW(v.videoWidth);
      setVideoH(v.videoHeight);


    };
    const onPlay = () => { setPlaying(true); setWaiting(false); startHideTimer(); };
    const onPause = () => {
      setPlaying(false);
      setShowControls(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
    const onWaiting = () => setWaiting(true);
    const onPlaying = () => setWaiting(false);
    const onCanPlay = () => setWaiting(false);
    const onVol = () => { setVolume(v.volume); setMuted(v.muted); };
    const onProg = () => { if (v.buffered.length > 0) setBuffered(v.buffered.end(v.buffered.length - 1)); };
    const onErr = () => onError();
    const onEnterPip = () => setPipActive(true);
    const onLeavePip = () => setPipActive(false);
    const onEnded = () => {
      setPlaying(false);
      setShowControls(true);
      if (onAutoNext) onAutoNext();
    };
    const onWebkitFs = () => {
      // iOS Safari webkit video fullscreen events
      const isFs = !!v.webkitDisplayingFullscreen;
      setIsFullscreen(isFs);
      if (!isFs) setShowControls(true);
    };

    v.addEventListener('timeupdate', onTime);
    v.addEventListener('durationchange', onDur);
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('waiting', onWaiting);
    v.addEventListener('playing', onPlaying);
    v.addEventListener('canplay', onCanPlay);
    v.addEventListener('volumechange', onVol);
    v.addEventListener('progress', onProg);
    v.addEventListener('error', onErr);
    v.addEventListener('enterpictureinpicture', onEnterPip);
    v.addEventListener('leavepictureinpicture', onLeavePip);
    v.addEventListener('webkitbeginfullscreen', onWebkitFs);
    v.addEventListener('webkitendfullscreen', onWebkitFs);
    v.addEventListener('ended', onEnded);

    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('durationchange', onDur);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('waiting', onWaiting);
      v.removeEventListener('playing', onPlaying);
      v.removeEventListener('canplay', onCanPlay);
      v.removeEventListener('volumechange', onVol);
      v.removeEventListener('progress', onProg);
      v.removeEventListener('error', onErr);
      v.removeEventListener('enterpictureinpicture', onEnterPip);
      v.removeEventListener('leavepictureinpicture', onLeavePip);
      v.removeEventListener('webkitbeginfullscreen', onWebkitFs);
      v.removeEventListener('webkitendfullscreen', onWebkitFs);
      v.removeEventListener('ended', onEnded);
    };
  }, [startHideTimer, onError, fileId, onAutoNext, subtitleOffset]);

  /* ── Fullscreen change listener ── */
  useEffect(() => {
    const handler = () => {
      const fs = !!(document.fullscreenElement || (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement);
      setIsFullscreen(fs);
      if (!fs) {
        setShowControls(true);
        // Unlock orientation on exit
        const screen = window.screen as OrientationScreen;
        if (screen?.orientation?.unlock) {
          screen.orientation.unlock();
        }
      }
    };
    document.addEventListener('fullscreenchange', handler);
    document.addEventListener('webkitfullscreenchange', handler);
    return () => {
      document.removeEventListener('fullscreenchange', handler);
      document.removeEventListener('webkitfullscreenchange', handler);
    };
  }, []);

  /* ── Subtitle loading ── */
  useEffect(() => {
    if (subtitleBlobRef.current) {
      URL.revokeObjectURL(subtitleBlobRef.current);
      subtitleBlobRef.current = null;
    }
    setSubtitleUrl(null);
    if (activeSubtitleIdx < 0 || activeSubtitleIdx >= subtitleTracks.length) return;
    setSubtitleLoading(true);
    loadSubtitleBlobUrl(subtitleTracks[activeSubtitleIdx])
      .then((url) => {
        subtitleBlobRef.current = url;
        setSubtitleUrl(url);
      })
      .catch(() => { setActiveSubtitleIdx(-1); })
      .finally(() => setSubtitleLoading(false));
    return () => {
      if (subtitleBlobRef.current) {
        URL.revokeObjectURL(subtitleBlobRef.current);
        subtitleBlobRef.current = null;
      }
    };
  }, [activeSubtitleIdx, subtitleTracks]);

  /* ── Apply subtitle offset to cue times ── */
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !subtitleUrl) return;
    const applyOffset = () => {
      const tracks = v.textTracks;
      for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        if (track.cues) {
          for (let j = 0; j < track.cues.length; j++) {
            const cue = track.cues[j] as TextTrackCue & {
              _originalStart?: number;
              _originalEnd?: number;
            };
            if (cue._originalStart === undefined) {
              cue._originalStart = cue.startTime;
              cue._originalEnd = cue.endTime;
            }
            cue.startTime = Math.max(0, cue._originalStart + subtitleOffset);
            cue.endTime = Math.max(0, (cue._originalEnd ?? cue.endTime) + subtitleOffset);
          }
        }
      }
    };
    applyOffset();
    const onLoaded = () => applyOffset();
    v.textTracks.addEventListener('cuechange', () => {});
    if (v.readyState >= 2) applyOffset();
    else v.addEventListener('loadeddata', onLoaded);
    return () => {
      v.removeEventListener('loadeddata', onLoaded);
    };
  }, [subtitleUrl, subtitleOffset]);

  /* ── Cleanup timers on unmount ── */
  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
      if (seekHintTimer.current) clearTimeout(seekHintTimer.current);
      if (subtitleBlobRef.current) URL.revokeObjectURL(subtitleBlobRef.current);
    };
  }, []);

  const seekPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufPct = duration > 0 ? (buffered / duration) * 100 : 0;
  const resolution = videoW && videoH ? `${videoW}×${videoH}` : '—';
  const codecStr = mimeType.split('/')[1]?.toUpperCase() || '—';
  const VolIcon = muted || volume === 0 ? VolumeX : Volume2;

  return (
    <div
      ref={rootRef}
      data-no-edge-swipe
      className={cn(
        'relative bg-black overflow-hidden select-none',
        isFullscreen
          ? 'fixed inset-0 z-[60] w-screen h-screen'
          : 'rounded-xl w-full flex-1 min-h-0'
      )}
      style={isFullscreen ? undefined : { height: '100%', minHeight: '0' }}
      onMouseMove={() => { if (showControls) reveal(); }}
    >
      {/* ── Video stage (fills entire root, video centered with object-fit) ── */}
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{ touchAction: 'none' }}
        onTouchStart={onStageTouchStart}
        onTouchMove={onStageTouchMove}
        onTouchEnd={onStageTouchEnd}
        onClick={onStageClick}
      >
        <video
          ref={videoRef}
          src={src}
          autoPlay
          playsInline
          className="max-w-full max-h-full"
          style={{ objectFit: 'contain' }}
          onError={onError}
        >
          {subtitleUrl && (
            <track
              kind="subtitles"
              src={subtitleUrl}
              default
              label="Subtitles"
            />
          )}
        </video>
      </div>

      {/* ── Loading ── */}
      {waiting && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <div className={cn(
            'border-2 border-white/20 border-t-white rounded-full animate-spin',
            playing ? 'w-6 h-6 border-white/10 border-t-white/60' : 'w-9 h-9'
          )} />
        </div>
      )}

      {/* ── Seek feedback: small circular arrow at center ── */}
      {seekHint && (
        <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
          <SeekArrow dir={seekHint.dir} />
        </div>
      )}

      {/* ── Center play/pause ── */}
      <div className={cn(
        'absolute inset-0 z-20 flex items-center justify-center pointer-events-none transition-opacity duration-200',
        showControls ? 'opacity-100' : 'opacity-0'
      )}>
        <button
          onClick={(e) => { e.stopPropagation(); togglePlay(); }}
          className="w-16 h-16 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center pointer-events-auto active:scale-90 transition-transform"
        >
          {playing
            ? <Pause className="w-7 h-7 text-white" fill="currentColor" />
            : <Play className="w-7 h-7 text-white ml-0.5" fill="currentColor" />}
        </button>
      </div>

      {/* ── Normal mode: clean minimal top info ── */}
      {showControls && !cyberVision && (
        <div
          className="absolute top-0 left-0 right-0 z-20 px-4 pt-2 pb-8 bg-gradient-to-b from-black/60 to-transparent pointer-events-none"
          style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
        >
          <p className="text-[13px] text-white/80 font-medium truncate">{fileName}</p>
        </div>
      )}

      {/* ── Cyber Vision HUD ── */}
      {cyberVision && (
        <div className={cn(
          'absolute inset-0 z-[15] pointer-events-none transition-opacity duration-200',
          showControls ? 'opacity-100' : 'opacity-30'
        )}>
          <div className="absolute top-1.5 left-1.5 w-6 h-6 border-t border-l border-cyber-green/40 rounded-tl-md" />
          <div className="absolute top-1.5 right-1.5 w-6 h-6 border-t border-r border-cyber-green/40 rounded-tr-md" />
          <div className="absolute bottom-1.5 left-1.5 w-6 h-6 border-b border-l border-cyber-green/40 rounded-bl-md" />
          <div className="absolute bottom-1.5 right-1.5 w-6 h-6 border-b border-r border-cyber-green/40 rounded-br-md" />
          <div className="absolute left-0 right-0 h-px bg-cyber-green/15 animate-scan-line" />
          <div className="absolute top-3 left-3 space-y-0.5" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
            <div className="flex items-center gap-1.5">
              <span className={cn('w-1.5 h-1.5 rounded-full', playing ? 'bg-cyber-green animate-pulse' : 'bg-cyber-gray-text')} />
              <span className="font-mono text-[9px] text-cyber-green/70 tracking-wider">AM0SP // CYBER VISION</span>
            </div>
            <p className="font-mono text-[9px] text-cyber-green/40 leading-tight truncate max-w-[160px]">{fileName}</p>
          </div>
          <div className="absolute top-3 right-3 text-right space-y-0.5" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
            <p className="font-mono text-[9px] text-cyber-green/40">{resolution}</p>
            <p className="font-mono text-[9px] text-cyber-green/30">{codecStr}</p>
          </div>
          <div className="absolute bottom-3 left-3 space-y-0.5">
            <p className="font-mono text-[9px] text-cyber-green/30">BUF {bufPct > 0 ? Math.round(bufPct) : 0}%</p>
            <p className="font-mono text-[9px] text-cyber-green/30">PLAYBACK {playbackRate.toFixed(1)}X</p>
          </div>
          <div className="absolute bottom-3 right-3 text-right space-y-0.5">
            <p className="font-mono text-[9px] text-cyber-green/30">{formatTime(currentTime)} / {formatTime(duration)}</p>
            <p className="font-mono text-[9px] text-cyber-green/30">{playing ? 'STREAM ACTIVE' : 'PAUSED'}</p>
          </div>
        </div>
      )}

      {/* ── Settings panel ── */}
      {showSettings && showControls && (
        <>
          <div className="absolute inset-0 z-[25]" onClick={(e) => { e.stopPropagation(); setShowSettings(false); }} />
          <div className="absolute z-30 bottom-14 right-2 w-44 rounded-xl bg-black/85 backdrop-blur-md border border-white/10 overflow-hidden">
            <div className="px-3 py-2 border-b border-white/5">
              <p className="text-[10px] text-white/40 font-mono mb-1.5 uppercase tracking-wider">Speed</p>
              <div className="flex gap-1">
                {[0.5, 1, 1.5, 2].map((rate) => (
                  <button
                    key={rate}
                    onClick={(e) => { e.stopPropagation(); setSpeed(rate); }}
                    className={cn(
                      'flex-1 py-1.5 rounded-md text-xs font-mono',
                      playbackRate === rate ? 'bg-white/15 text-white' : 'text-white/50 active:bg-white/10'
                    )}
                  >
                    {rate}×
                  </button>
                ))}
              </div>
            </div>
            <div className="px-3 py-2 border-b border-white/5">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[10px] text-white/40 font-mono uppercase tracking-wider">Subtitles</p>
                {subtitleTracks.length > 0 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setActiveSubtitleIdx(activeSubtitleIdx >= 0 ? -1 : 0); }}
                    className={cn(
                      'px-1.5 py-0.5 rounded text-[9px] font-mono',
                      activeSubtitleIdx >= 0 ? 'bg-cyber-green/20 text-cyber-green' : 'bg-white/10 text-white/50'
                    )}
                  >
                    {activeSubtitleIdx >= 0 ? 'ON' : 'OFF'}
                  </button>
                )}
              </div>
              {subtitleTracks.length === 0 ? (
                <p className="text-[9px] text-white/30 font-mono py-1">No subtitle files found for this video.</p>
              ) : activeSubtitleIdx >= 0 ? (
                <>
                  <div className="flex gap-1 mb-1.5 max-h-20 overflow-y-auto">
                    {subtitleTracks.map((track, idx) => (
                      <button
                        key={track.id}
                        onClick={(e) => { e.stopPropagation(); setActiveSubtitleIdx(idx); }}
                        className={cn(
                          'flex-1 py-1 rounded-md text-[9px] font-mono truncate',
                          activeSubtitleIdx === idx ? 'bg-white/15 text-white' : 'text-white/50 active:bg-white/10'
                        )}
                        title={track.label}
                      >
                        {track.label.split('.').slice(0, -1).join('.').split('.').pop() || track.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1">
                    <p className="text-[9px] text-white/40 font-mono">Sync</p>
                    <button
                      onClick={(e) => { e.stopPropagation(); setSubtitleOffset((o) => Math.max(-30, o - 0.5)); }}
                      className="p-0.5 rounded bg-white/10 text-white/60 active:bg-white/20"
                    >
                      <ChevronDown className="w-3 h-3" />
                    </button>
                    <span className="text-[9px] text-white/60 font-mono min-w-[2.5rem] text-center">
                      {subtitleOffset > 0 ? '+' : ''}{subtitleOffset.toFixed(1)}s
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setSubtitleOffset((o) => Math.min(30, o + 0.5)); }}
                      className="p-0.5 rounded bg-white/10 text-white/60 active:bg-white/20"
                    >
                      <ChevronUp className="w-3 h-3" />
                    </button>
                  </div>
                </>
              ) : (
                <p className="text-[9px] text-white/30 font-mono py-1">Subtitles are off.</p>
              )}
              {subtitleLoading && (
                <p className="text-[9px] text-white/30 font-mono mt-1">Loading…</p>
              )}
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); setCyberVision((s) => !s); }}
              className="w-full px-3 py-2.5 flex items-center gap-2 active:bg-white/10"
            >
              <CyberVisionIcon active={cyberVision} />
              <span className={cn('text-xs font-mono', cyberVision ? 'text-cyber-green' : 'text-white/50')}>
                {cyberVision ? 'VISION ON' : 'CYBER VISION'}
              </span>
            </button>
          </div>
        </>
      )}

      {/* ── Bottom controls — positioned relative to root container ── */}
      <div
        className={cn(
          'absolute bottom-0 left-0 right-0 z-20 px-3 pt-12 transition-opacity duration-200',
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none',
          'bg-gradient-to-t from-black/90 via-black/50 to-transparent'
        )}
        style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
      >
        <div
          ref={seekBarRef}
          className="relative h-1.5 rounded-full bg-white/20 mb-2 touch-none"
          onPointerDown={onSeekBarDown}
          onPointerMove={onSeekBarMove}
          onPointerUp={onSeekBarUp}
        >
          <div className="absolute inset-y-0 left-0 rounded-full bg-white/20" style={{ width: `${bufPct}%` }} />
          <div className="absolute inset-y-0 left-0 rounded-full bg-white" style={{ width: `${seekPct}%` }}>
            <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-3 h-3 rounded-full bg-white" />
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button onClick={(e) => { e.stopPropagation(); togglePlay(); }} className="p-2 rounded-lg text-white active:bg-white/20 flex-shrink-0">
            {playing ? <Pause className="w-6 h-6" fill="currentColor" /> : <Play className="w-6 h-6" fill="currentColor" />}
          </button>
          <button onClick={(e) => { e.stopPropagation(); toggleMute(); }} className="p-2 rounded-lg text-white/80 active:bg-white/20 flex-shrink-0">
            <VolIcon className="w-6 h-6" />
          </button>
          <div className="flex items-center gap-1 text-[12px] font-mono text-white/70 flex-shrink-0 ml-1">
            <span>{formatTime(currentTime)}</span>
            <span className="text-white/30">/</span>
            <span className="text-white/40">{formatTime(duration)}</span>
          </div>
          <div className="flex-1" />
          <button
            onClick={(e) => { e.stopPropagation(); setShowSettings((s) => !s); }}
            className={cn('p-2 rounded-lg flex-shrink-0', showSettings ? 'text-white bg-white/15' : 'text-white/80 active:bg-white/20')}
          >
            <Settings className="w-6 h-6" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setCyberVision((s) => !s); }}
            className="p-2 rounded-lg active:bg-white/20 flex-shrink-0"
          >
            <CyberVisionIcon active={cyberVision} />
          </button>
          {/* Rotate = fullscreen landscape (Telegram-style) */}
          <button
            onClick={(e) => { e.stopPropagation(); enterFullscreenLandscape(); }}
            className={cn('p-2 rounded-lg flex-shrink-0', isFullscreen ? 'text-white bg-white/15' : 'text-white/80 active:bg-white/20')}
          >
            <Expand className="w-6 h-6" />
          </button>
          {canPip && (
            <button
              onClick={(e) => { e.stopPropagation(); togglePip(); }}
              className={cn('p-2 rounded-lg flex-shrink-0', pipActive ? 'text-cyber-green bg-cyber-green/15' : 'text-white/80 active:bg-white/20')}
            >
              <PictureInPicture className="w-6 h-6" />
            </button>
          )}
          {canFullscreen && (
            <button onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }} className="p-2 rounded-lg text-white/80 active:bg-white/20 flex-shrink-0">
              {isFullscreen ? <Minimize className="w-6 h-6" /> : <Maximize className="w-6 h-6" />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
