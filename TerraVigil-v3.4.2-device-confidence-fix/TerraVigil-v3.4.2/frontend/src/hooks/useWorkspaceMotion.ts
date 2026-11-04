import { useLayoutEffect, type RefObject } from 'react';
import { gsap } from 'gsap';

/** Animate only static page headings, never telemetry, maps, tables, or evidence values. */
export function useWorkspaceMotion(scope: RefObject<HTMLElement | null>, route: string) {
  useLayoutEffect(() => {
    const media = gsap.matchMedia();
    media.add(
      '(prefers-reduced-motion: no-preference)',
      () => {
        const headings = scope.current?.querySelectorAll(
          '.app-page-header .type-page-title, .ops-intro-title',
        );
        if (headings?.length)
          gsap.from(headings, { opacity: 0.75, y: 3, duration: 0.14, ease: 'power1.out' });
      },
      scope,
    );
    return () => {
      media.revert();
    };
  }, [scope, route]);
}
