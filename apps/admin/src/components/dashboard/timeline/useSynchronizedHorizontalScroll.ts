'use client';

import {
  useCallback,
  useEffect,
  useRef,
  type MutableRefObject,
  type RefObject,
} from 'react';

/**
 * Keep two (or more) horizontal scroll containers in sync.
 * Uses a lock flag to avoid feedback loops.
 */
export function useSynchronizedHorizontalScroll(
  refs: Array<RefObject<HTMLElement | null>>,
  onScrollLeft?: (scrollLeft: number) => void,
) {
  const lock = useRef(false);
  const onScrollLeftRef = useRef(onScrollLeft);
  onScrollLeftRef.current = onScrollLeft;

  const applyScroll = useCallback(
    (source: HTMLElement, scrollLeft: number) => {
      if (lock.current) return;
      lock.current = true;
      for (const ref of refs) {
        const el = ref.current;
        if (!el || el === source) continue;
        if (Math.abs(el.scrollLeft - scrollLeft) > 0.5) {
          el.scrollLeft = scrollLeft;
        }
      }
      onScrollLeftRef.current?.(scrollLeft);
      requestAnimationFrame(() => {
        lock.current = false;
      });
    },
    [refs],
  );

  const setAllScrollLeft = useCallback(
    (scrollLeft: number, behavior: ScrollBehavior = 'auto') => {
      lock.current = true;
      for (const ref of refs) {
        const el = ref.current;
        if (!el) continue;
        if (behavior === 'smooth' && 'scrollTo' in el) {
          el.scrollTo({ left: scrollLeft, behavior: 'smooth' });
        } else {
          el.scrollLeft = scrollLeft;
        }
      }
      onScrollLeftRef.current?.(scrollLeft);
      requestAnimationFrame(() => {
        lock.current = false;
      });
    },
    [refs],
  );

  useEffect(() => {
    const cleanups: Array<() => void> = [];
    for (const ref of refs) {
      const el = ref.current;
      if (!el) continue;
      const handler = () => applyScroll(el, el.scrollLeft);
      el.addEventListener('scroll', handler, { passive: true });
      cleanups.push(() => el.removeEventListener('scroll', handler));
    }
    return () => cleanups.forEach((fn) => fn());
  }, [refs, applyScroll]);

  return { setAllScrollLeft };
}

/** Pointer / touch drag-to-scroll for a horizontal container. */
export function useDragScroll(ref: RefObject<HTMLElement | null> | MutableRefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let active = false;
    let startX = 0;
    let startScroll = 0;
    let moved = false;

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      active = true;
      moved = false;
      startX = e.clientX;
      startScroll = el.scrollLeft;
      el.setPointerCapture?.(e.pointerId);
      el.style.cursor = 'grabbing';
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!active) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 3) moved = true;
      el.scrollLeft = startScroll - dx;
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!active) return;
      active = false;
      el.style.cursor = 'grab';
      el.releasePointerCapture?.(e.pointerId);
      // Mark drag so click handlers can ignore
      if (moved) {
        el.dataset.dragged = '1';
        window.setTimeout(() => {
          delete el.dataset.dragged;
        }, 0);
      }
    };

    el.style.cursor = 'grab';
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
    };
  }, [ref]);
}
