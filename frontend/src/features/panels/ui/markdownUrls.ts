// URL transform for markdown-embedded asset references (HEL-245).
//
// Markdown authors reference uploaded images with a stable
// `helio://uploads/image/<id>` scheme. react-markdown v10's default
// `urlTransform` strips unknown protocols (so a bare `helio://` URL would
// resolve to an empty `src`), so we intercept that one scheme and rewrite it
// to the public uploads route (`/api/uploads/image/<id>`), delegating every
// other URL to react-markdown's own `defaultUrlTransform`.

import { defaultUrlTransform } from "react-markdown";

const HELIO_IMAGE_PREFIX = "helio://uploads/image/";

// A resolved upload id is a single safe path segment: no slashes, no `.`/`..`
// traversal, no query/hash. Anything else is rejected and falls through to the
// default transform (which strips the unknown `helio://` protocol).
const SAFE_ID = /^[A-Za-z0-9._-]+$/;

/**
 * Resolve a markdown URL for rendering.
 *
 * - `helio://uploads/image/<id>` with a safe single-segment `<id>` →
 *   `/api/uploads/image/<id>`.
 * - Any other `helio://` URL (or an unsafe id) → delegated to
 *   `defaultUrlTransform`, which strips the unknown protocol.
 * - Every non-`helio://` URL → delegated to `defaultUrlTransform` unchanged
 *   (relative `/api/uploads/image/<id>` URLs already survive it).
 *
 * Applies to links and images alike — a `helio://` link resolves to the same
 * asset as the equivalent image ref, which is intended.
 */
export function resolveMarkdownUrl(url: string): string {
  if (url.startsWith(HELIO_IMAGE_PREFIX)) {
    const id = url.slice(HELIO_IMAGE_PREFIX.length);
    if (SAFE_ID.test(id) && id !== "." && id !== "..") {
      return `/api/uploads/image/${id}`;
    }
  }
  return defaultUrlTransform(url);
}
