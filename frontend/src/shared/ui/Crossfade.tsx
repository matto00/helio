import { useEffect, useRef, useState, type ReactNode } from "react";

import "./Crossfade.css";

interface CrossfadeProps {
  /** True while the content is not ready; the skeleton shows and `children` are NOT rendered. */
  loading: boolean;
  /** The placeholder shown while loading, and faded out in place when loading ends. */
  skeleton: ReactNode;
  children: ReactNode;
}

/** Crossfade (HEL-1573, DESIGN.md §10): a skeleton fading into content in place. Both layers share one grid cell, so the
 *  container never collapses between them. `children` mount only when `loading` ends (a Suspense fallback cannot render
 *  them earlier either) and fade in with a keyframe animation, since a freshly inserted node has no style to transition
 *  from; the outgoing skeleton fades out by transition. The moment loading ends the skeleton is `aria-hidden` and
 *  `inert`, so it never announces "loading" again, and it unmounts at the first of `transitionend`,
 *  `transitioncancel`, or (checked on the next animation frame) no running animation on it: loading that finished
 *  before the skeleton painted, an instant Off swap and jsdom. Opacity only, so it runs under Subtle. */
export function Crossfade({ loading, skeleton, children }: CrossfadeProps) {
  const [skeletonGone, setSkeletonGone] = useState(!loading);
  const [wasLoading, setWasLoading] = useState(loading);
  // Content that replaces a skeleton fades in; content that was there from the start does not animate.
  const [fadesIn, setFadesIn] = useState(loading);
  const layerRef = useRef<HTMLDivElement>(null);

  // Loading (re)starts: bring the skeleton back. React's "adjust state while rendering".
  if (loading !== wasLoading) {
    setWasLoading(loading);
    if (loading) {
      setSkeletonGone(false);
      setFadesIn(true);
    }
  }

  const leaving = !loading && !skeletonGone;
  useEffect(() => {
    if (!leaving) return undefined;
    const layer = layerRef.current;
    const finish = (event: Event) => {
      // Only the layer's own fade counts, not a transition bubbling up from the skeleton's contents.
      if (event.target === layer) setSkeletonGone(true);
    };
    layer?.addEventListener("transitionend", finish);
    layer?.addEventListener("transitioncancel", finish);
    const frame = requestAnimationFrame(() => {
      const running = layer?.getAnimations?.() ?? [];
      if (running.length === 0) setSkeletonGone(true);
    });
    return () => {
      layer?.removeEventListener("transitionend", finish);
      layer?.removeEventListener("transitioncancel", finish);
      cancelAnimationFrame(frame);
    };
  }, [leaving]);

  return (
    <div className="crossfade">
      {(loading || !skeletonGone) && (
        <div
          ref={layerRef}
          className={`crossfade__layer crossfade__skeleton${loading ? "" : " crossfade__skeleton--leaving"}`}
          aria-hidden={loading ? undefined : true}
          inert={loading ? undefined : true}
        >
          {skeleton}
        </div>
      )}
      {!loading && (
        <div className={`crossfade__layer${fadesIn ? " crossfade__content--entering" : ""}`}>
          {children}
        </div>
      )}
    </div>
  );
}
