import { useEffect, useRef } from "react";

export function useIntersectionSentinel(opts: {
  enabled: boolean;
  onIntersect: () => void;
  rootMargin?: string;
  threshold?: number;
  root?: Element | null;
}) {
  const { enabled, onIntersect, rootMargin = "800px 0px", threshold = 0, root = null } = opts;
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const el = ref.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onIntersect();
      },
      { root, rootMargin, threshold }
    );

    obs.observe(el);
    return () => obs.disconnect();
  }, [enabled, onIntersect, root, rootMargin, threshold]);

  return ref;
}