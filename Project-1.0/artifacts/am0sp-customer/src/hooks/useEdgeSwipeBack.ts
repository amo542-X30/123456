import { useEffect, useRef } from 'react';

/**
 * Listens for a touch swipe that starts at the left edge of the screen
 * (within `edgeWidth` px) and moves rightward beyond `threshold` px.
 * Calls `onBack` when the gesture completes.
 *
 * This is a global listener — the caller decides what "back" means
 * (e.g. close a modal, go up a folder, or navigate to the previous page).
 * Media swipe handlers inside the video player / zoomable image only
 * trigger for swipes starting away from the edge, so there is no conflict.
 */
export function useEdgeSwipeBack(onBack: () => void, edgeWidth = 24, threshold = 60): void {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let active = false;
    let moved = false;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      if (t.clientX > edgeWidth) return;
      startX = t.clientX;
      startY = t.clientY;
      active = true;
      moved = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!active || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (Math.abs(dx) > 10 && dx > Math.abs(dy)) {
        moved = true;
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!active) return;
      active = false;
      if (!moved) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (dx > threshold && dx > Math.abs(dy) * 1.3) {
        onBackRef.current();
      }
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, [edgeWidth, threshold]);
}
