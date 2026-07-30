'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type ReactNode,
} from 'react';
import { useDragScroll } from './useSynchronizedHorizontalScroll';

export type ScrollableTimeSeriesHandle = {
  getElement: () => HTMLDivElement | null;
  scrollToLeft: (left: number, behavior?: ScrollBehavior) => void;
};

type Props = {
  children: ReactNode;
  contentWidth: number;
  className?: string;
  ariaLabel: string;
  onScrollLeft?: (scrollLeft: number) => void;
};

/**
 * Contained horizontal timeline viewport:
 * native trackpad scroll, shift+wheel, drag, touch, custom thin scrollbar, edge fades.
 */
export const ScrollableTimeSeries = forwardRef<ScrollableTimeSeriesHandle, Props>(
  function ScrollableTimeSeries(
    { children, contentWidth, className, ariaLabel, onScrollLeft },
    ref,
  ) {
    const viewportRef = useRef<HTMLDivElement>(null);
    useDragScroll(viewportRef);

    useImperativeHandle(ref, () => ({
      getElement: () => viewportRef.current,
      scrollToLeft: (left, behavior = 'auto') => {
        const el = viewportRef.current;
        if (!el) return;
        if (behavior === 'smooth') {
          el.scrollTo({ left, behavior: 'smooth' });
        } else {
          el.scrollLeft = left;
        }
      },
    }));

    useEffect(() => {
      const el = viewportRef.current;
      if (!el || !onScrollLeft) return;
      const handler = () => onScrollLeft(el.scrollLeft);
      el.addEventListener('scroll', handler, { passive: true });
      return () => el.removeEventListener('scroll', handler);
    }, [onScrollLeft]);

    // Shift + wheel → horizontal
    useEffect(() => {
      const el = viewportRef.current;
      if (!el) return;
      const onWheel = (e: WheelEvent) => {
        if (e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          e.preventDefault();
          el.scrollLeft += e.deltaY;
        }
      };
      el.addEventListener('wheel', onWheel, { passive: false });
      return () => el.removeEventListener('wheel', onWheel);
    }, []);

    return (
      <div className={`relative min-w-0 ${className ?? ''}`}>
        <div
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-gradient-to-r from-panel to-transparent"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-6 bg-gradient-to-l from-panel to-transparent"
          aria-hidden
        />
        <div
          ref={viewportRef}
          role="region"
          aria-label={ariaLabel}
          tabIndex={0}
          className="timeline-scroll h-full w-full overflow-x-auto overflow-y-hidden overscroll-x-contain focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/30"
        >
          <div style={{ width: contentWidth, minWidth: '100%', height: '100%' }}>
            {children}
          </div>
        </div>
        <style>{`
          .timeline-scroll {
            scrollbar-width: thin;
            scrollbar-color: rgba(255, 255, 255, 0.22) transparent;
          }
          .timeline-scroll::-webkit-scrollbar {
            height: 6px;
          }
          .timeline-scroll::-webkit-scrollbar-track {
            background: transparent;
          }
          .timeline-scroll::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.18);
            border-radius: 999px;
          }
          .timeline-scroll::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.32);
          }
          @media (prefers-reduced-motion: reduce) {
            .timeline-scroll {
              scroll-behavior: auto !important;
            }
          }
        `}</style>
      </div>
    );
  },
);
