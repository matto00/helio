import { useEffect, useRef, useState, type ReactNode } from "react";

import "./Crossfade.css";

interface CrossfadeProps {
  /** True while the content is not ready; the skeleton shows and (unless `keepContentMounted`) `children` are NOT rendered. */
  loading: boolean;
  /** The placeholder shown while loading, and faded out in place when loading ends. */
  skeleton: ReactNode;
  children: ReactNode;
  /** Whether the content layer fades in when loading ends (default true). False when the content brings its own entrance
   *  (the grid's cards), so a layer fade on top does not compound opacity; only the skeleton fades out. */
  contentFade?: boolean;
  /** Lay the two layers out as blocks instead of a flex row (default false), so wrapped content that has no width of its own
   *  (a grid root, a width-less column, a route page) keeps its container's full width. */
  block?: boolean;
  /** Render `children` while loading too, invisible and inert, so a Suspense boundary inside them can resolve (default false;
   *  the caller flips `loading` once it has). Fades then only run when the skeleton has painted: a load that ends before the
   *  first animation frame (a cached chunk) swaps with no fade at all. */
  keepContentMounted?: boolean;
}

/** Crossfade (HEL-1573, DESIGN.md §10): a skeleton fading into content in place. Both layers share one grid cell, so the
 *  container never collapses between them. By default `children` mount only when `loading` ends and fade in with a keyframe
 *  animation, since a freshly inserted node has no style to transition from; the outgoing skeleton fades out by
 *  transition. The moment loading ends the skeleton is `aria-hidden` and `inert`, so it never announces "loading" again,
 *  and it unmounts at the first of `transitionend`, `transitioncancel`, or (checked on the next animation frame) no running
 *  animation on it: loading that finished before the skeleton painted, an instant Off swap and jsdom. Opacity only, so
 *  it runs under Subtle. HEL-1584 options: `contentFade`, `block` and `keepContentMounted`. */
export function Crossfade({
  loading,
  skeleton,
  children,
  contentFade = true,
  block = false,
  keepContentMounted = false,
}: CrossfadeProps) {
  const [skeletonGone, setSkeletonGone] = useState(!loading);
  const [wasLoading, setWasLoading] = useState(loading);
  // Content that replaces a skeleton fades in; content that was there from the start does not animate.
  const [fadesIn, setFadesIn] = useState(loading);
  // keepContentMounted only: has the skeleton had a frame on screen yet? Set by one rAF after mount.
  const [painted, setPainted] = useState(false);
  const layerRef = useRef<HTMLDivElement>(null);

  // Loading (re)starts or ends: React's "adjust state while rendering".
  if (loading !== wasLoading) {
    setWasLoading(loading);
    if (loading) {
      setSkeletonGone(false);
      setFadesIn(true);
    } else if (keepContentMounted && !painted) {
      // The skeleton never painted: swap with no fade at all.
      setSkeletonGone(true);
      setFadesIn(false);
    }
  }

  useEffect(() => {
    if (!keepContentMounted || painted) return undefined;
    const frame = requestAnimationFrame(() => setPainted(true));
    return () => cancelAnimationFrame(frame);
  }, [keepContentMounted, painted]);

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

  const pending = keepContentMounted && loading;
  const contentClass = [
    "crossfade__layer",
    pending ? "crossfade__content--pending" : null,
    !loading && fadesIn && contentFade ? "crossfade__content--entering" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={block ? "crossfade crossfade--block" : "crossfade"}>
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
      {(!loading || keepContentMounted) && (
        <div
          className={contentClass}
          aria-hidden={pending ? true : undefined}
          inert={pending ? true : undefined}
        >
          {children}
        </div>
      )}
    </div>
  );
}
