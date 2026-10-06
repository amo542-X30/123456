import { useRef, useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, ArrowDownToLine, AlertCircle } from 'lucide-react';
import type { FileItem } from '@/lib/types';
import { formatBytes, formatDate, cn } from '@/lib/utils';

interface PhotoViewerProps {
  photos: FileItem[];
  currentIndex: number;
  url: string | null;
  loading: boolean;
  error: string | null;
  imgError: boolean;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onDownload: (file: FileItem) => void;
  onRetry: () => void;
  onError: () => void;
  onLoad: () => void;
}

export function PhotoViewer({
  photos, currentIndex, url, loading, error, imgError,
  onIndexChange, onClose, onDownload, onRetry, onError, onLoad,
}: PhotoViewerProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTap = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTouch = useRef(false);

  const zoom = useRef({
    scale: 1,
    x: 0,
    y: 0,
    pinchDist: 0,
    dragging: false,
    dragStartX: 0,
    dragStartY: 0,
    baseX: 0,
    baseY: 0,
  });

  const swipe = useRef({
    startX: 0,
    startY: 0,
    active: false,
    moved: false,
  });

  const [showControls, setShowControls] = useState(true);
  const [displayScale, setDisplayScale] = useState(1);

  const file = photos[currentIndex];

  const applyTransform = useCallback(() => {
    if (imgRef.current) {
      const z = zoom.current;
      imgRef.current.style.transform = `translate(${z.x}px, ${z.y}px) scale(${z.scale})`;
    }
  }, []);

  const resetZoom = useCallback(() => {
    const z = zoom.current;
    z.scale = 1;
    z.x = 0;
    z.y = 0;
    setDisplayScale(1);
    if (imgRef.current) {
      imgRef.current.style.transition = 'transform 250ms cubic-bezier(0.25,0.46,0.45,0.94)';
      imgRef.current.style.transform = '';
      setTimeout(() => { if (imgRef.current) imgRef.current.style.transition = ''; }, 260);
    }
  }, []);

  const zoomTo = useCallback((target: number) => {
    const z = zoom.current;
    z.scale = target;
    if (target === 1) { z.x = 0; z.y = 0; }
    setDisplayScale(target);
    if (imgRef.current) {
      imgRef.current.style.transition = 'transform 250ms cubic-bezier(0.25,0.46,0.45,0.94)';
      applyTransform();
      setTimeout(() => { if (imgRef.current) imgRef.current.style.transition = ''; }, 260);
    }
  }, [applyTransform]);

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowControls(false), 3000);
  }, []);

  const revealControls = useCallback(() => {
    setShowControls(true);
    scheduleHide();
  }, [scheduleHide]);

  useEffect(() => {
    zoom.current.scale = 1;
    zoom.current.x = 0;
    zoom.current.y = 0;
    setDisplayScale(1);
    if (imgRef.current) imgRef.current.style.transform = '';
    revealControls();
  }, [currentIndex, revealControls]);

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (tapTimer.current) clearTimeout(tapTimer.current);
      if (clickTimer.current) clearTimeout(clickTimer.current);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowLeft' && currentIndex > 0) onIndexChange(currentIndex - 1);
      if (e.key === 'ArrowRight' && currentIndex < photos.length - 1) onIndexChange(currentIndex + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentIndex, photos.length, onIndexChange, onClose]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const z = zoom.current;
    const sw = swipe.current;

    const getDist = (t: TouchList) => {
      const dx = t[0].clientX - t[1].clientX;
      const dy = t[0].clientY - t[1].clientY;
      return Math.hypot(dx, dy);
    };

    const snapBack = () => {
      if (imgRef.current) {
        imgRef.current.style.transition = 'transform 250ms ease-out, opacity 250ms ease-out';
        imgRef.current.style.transform = '';
        imgRef.current.style.opacity = '1';
        setTimeout(() => { if (imgRef.current) imgRef.current.style.transition = ''; }, 260);
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      isTouch.current = true;
      sw.moved = false;
      if (e.touches.length === 2) {
        z.pinchDist = getDist(e.touches);
        z.dragging = false;
      } else if (e.touches.length === 1) {
        const t = e.touches[0];
        sw.startX = t.clientX;
        sw.startY = t.clientY;
        sw.active = false;
        if (z.scale > 1) {
          z.dragging = true;
          z.dragStartX = t.clientX;
          z.dragStartY = t.clientY;
          z.baseX = z.x;
          z.baseY = z.y;
        }
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      sw.moved = true;

      if (e.touches.length === 2 && z.pinchDist > 0) {
        const ratio = getDist(e.touches) / z.pinchDist;
        z.scale = Math.min(Math.max(z.scale * ratio, 1), 5);
        z.pinchDist = getDist(e.touches);
        if (z.scale === 1) { z.x = 0; z.y = 0; }
        applyTransform();
      } else if (e.touches.length === 1 && z.dragging && z.scale > 1) {
        z.x = z.baseX + (e.touches[0].clientX - z.dragStartX);
        z.y = z.baseY + (e.touches[0].clientY - z.dragStartY);
        applyTransform();
      } else if (e.touches.length === 1 && z.scale <= 1) {
        const dx = e.touches[0].clientX - sw.startX;
        const dy = e.touches[0].clientY - sw.startY;
        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
          sw.active = true;
          const atBoundary = (dx > 0 && currentIndex === 0) || (dx < 0 && currentIndex === photos.length - 1);
          const factor = atBoundary ? 0.3 : 0.5;
          if (imgRef.current) {
            imgRef.current.style.transition = 'none';
            imgRef.current.style.transform = `translateX(${dx * factor}px)`;
            imgRef.current.style.opacity = String(1 - Math.min(Math.abs(dx) / (window.innerWidth * 0.8), 0.5));
          }
        }
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) z.pinchDist = 0;
      if (e.touches.length > 0) return;

      z.dragging = false;
      setDisplayScale(z.scale);

      const touch = e.changedTouches[0];
      const dx = touch.clientX - sw.startX;
      const dy = touch.clientY - sw.startY;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      if (z.scale <= 1) {
        if (sw.active && absDx > 60 && absDx > absDy) {
          if (dx > 0 && currentIndex > 0) onIndexChange(currentIndex - 1);
          else if (dx < 0 && currentIndex < photos.length - 1) onIndexChange(currentIndex + 1);
          else snapBack();
        } else if (!sw.moved && absDx < 10 && absDy < 10) {
          const now = Date.now();
          if (now - lastTap.current < 280) {
            if (tapTimer.current) { clearTimeout(tapTimer.current); tapTimer.current = null; }
            if (z.scale > 1) resetZoom();
            else zoomTo(2);
            lastTap.current = 0;
          } else {
            lastTap.current = now;
            tapTimer.current = setTimeout(() => {
              setShowControls(prev => {
                if (prev) {
                  if (hideTimer.current) clearTimeout(hideTimer.current);
                  return false;
                }
                scheduleHide();
                return true;
              });
              tapTimer.current = null;
            }, 280);
          }
        } else {
          snapBack();
        }
      }

      sw.active = false;
    };

    const onMouseDown = (e: MouseEvent) => {
      isTouch.current = false;
      if (z.scale <= 1) return;
      z.dragging = true;
      z.dragStartX = e.clientX;
      z.dragStartY = e.clientY;
      z.baseX = z.x;
      z.baseY = z.y;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!z.dragging) return;
      z.x = z.baseX + (e.clientX - z.dragStartX);
      z.y = z.baseY + (e.clientY - z.dragStartY);
      applyTransform();
    };

    const onMouseUp = () => { z.dragging = false; };

    const onClick = () => {
      if (isTouch.current) return;
      if (clickTimer.current) { clearTimeout(clickTimer.current); clickTimer.current = null; return; }
      clickTimer.current = setTimeout(() => {
        setShowControls(prev => {
          if (prev) {
            if (hideTimer.current) clearTimeout(hideTimer.current);
            return false;
          }
          scheduleHide();
          return true;
        });
        clickTimer.current = null;
      }, 250);
    };

    const onDoubleClick = () => {
      if (isTouch.current) return;
      if (clickTimer.current) { clearTimeout(clickTimer.current); clickTimer.current = null; }
      if (z.scale > 1) resetZoom();
      else zoomTo(2);
    };

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        z.scale = Math.min(Math.max(z.scale + (e.deltaY > 0 ? -0.15 : 0.15), 1), 5);
        if (z.scale === 1) { z.x = 0; z.y = 0; }
        setDisplayScale(z.scale);
        applyTransform();
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: false });
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('mousemove', onMouseMove);
    el.addEventListener('mouseup', onMouseUp);
    el.addEventListener('mouseleave', onMouseUp);
    el.addEventListener('click', onClick);
    el.addEventListener('dblclick', onDoubleClick);

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('mousedown', onMouseDown);
      el.removeEventListener('mousemove', onMouseMove);
      el.removeEventListener('mouseup', onMouseUp);
      el.removeEventListener('mouseleave', onMouseUp);
      el.removeEventListener('click', onClick);
      el.removeEventListener('dblclick', onDoubleClick);
    };
  }, [applyTransform, currentIndex, photos.length, onIndexChange, resetZoom, zoomTo, scheduleHide]);

  if (!file) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black select-none animate-fade-in"
      data-no-edge-swipe
    >
      <div
        ref={containerRef}
        className="absolute inset-0 flex items-center justify-center overflow-hidden"
        style={{ touchAction: 'none' }}
      >
        {loading && (
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-cyber-green/30 border-t-cyber-green rounded-full animate-spin mx-auto mb-3" />
            <div className="terminal-text animate-pulse text-cyber-green/60">LOADING</div>
          </div>
        )}

        {error && !loading && (
          <div className="text-center px-8">
            <AlertCircle className="w-10 h-10 text-cyber-red mx-auto mb-3" />
            <p className="text-sm text-gray-300 mb-3">{error}</p>
            <button onClick={onRetry} className="btn-secondary text-xs">Retry</button>
          </div>
        )}

        {url && !loading && !error && !imgError && (
          <img
            ref={imgRef}
            src={url}
            alt={file.original_name}
            draggable={false}
            onError={onError}
            onLoad={onLoad}
            className="max-w-full max-h-full object-contain pointer-events-none"
            style={{ transform: 'translate(0px, 0px) scale(1)', willChange: 'transform' }}
          />
        )}

        {imgError && !loading && (
          <div className="text-center px-8">
            <AlertCircle className="w-10 h-10 text-cyber-red mx-auto mb-3" />
            <p className="text-sm text-gray-300 mb-2">Failed to load image</p>
            <button onClick={onRetry} className="btn-primary text-xs">Generate new URL</button>
          </div>
        )}
      </div>

      {/* Top bar */}
      <div
        className={cn(
          'absolute top-0 left-0 right-0 z-10 transition-all duration-300 ease-out',
          showControls ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 pointer-events-none',
        )}
        style={{
          paddingTop: 'env(safe-area-inset-top)',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0) 100%)',
        }}
      >
        <div className="flex items-center justify-between px-4 py-3">
          <button
            onClick={onClose}
            className="p-2 rounded-full bg-white/10 backdrop-blur-md text-white hover:bg-white/20 active:scale-90 transition-all"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>

          {photos.length > 1 && (
            <span className="text-white/90 text-sm font-medium tracking-wide px-3 py-1 rounded-full bg-white/10 backdrop-blur-md">
              {currentIndex + 1} / {photos.length}
            </span>
          )}

          <div className="w-9" />
        </div>
      </div>

      {/* Bottom bar */}
      <div
        className={cn(
          'absolute bottom-0 left-0 right-0 z-10 transition-all duration-300 ease-out',
          showControls ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none',
        )}
        style={{
          paddingBottom: 'env(safe-area-inset-bottom)',
          background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0) 100%)',
        }}
      >
        <div className="flex items-center justify-between px-4 py-3 gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-white text-sm font-medium truncate">{file.original_name}</p>
            <p className="text-white/50 text-xs mt-0.5">
              {formatBytes(file.size_bytes)} · {formatDate(file.created_at)}
            </p>
          </div>
          <button
            onClick={() => onDownload(file)}
            className="p-2.5 rounded-full bg-white/10 backdrop-blur-md text-white hover:bg-white/20 active:scale-90 transition-all flex-shrink-0"
            aria-label="Download"
          >
            <ArrowDownToLine className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Zoom indicator */}
      {displayScale > 1.05 && (
        <div className={cn(
          'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[5] transition-opacity duration-200 pointer-events-none',
          showControls ? 'opacity-0' : 'opacity-100',
        )}>
          <span className="text-white/50 text-xs font-medium bg-black/50 px-2.5 py-1 rounded-full backdrop-blur-sm">
            {Math.round(displayScale * 100)}%
          </span>
        </div>
      )}
    </div>,
    document.body,
  );
}
