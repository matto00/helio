import { useState, type CSSProperties } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faImage } from "@fortawesome/free-solid-svg-icons";

import "./ImagePanel.css";

interface ImagePanelProps {
  imageUrl: string | null;
  imageFit: string | null;
  caption?: string | null;
}

// HEL-246: a root-relative internal upload path (`/api/uploads/image/<id>`,
// as returned by the upload endpoint) has no scheme of its own, so it must
// be resolved against a base URL to parse at all — `new URL(url)` (no base)
// throws for any relative input. Resolving against `window.location.origin`
// lets both an absolute `http(s)://` URL and a root-relative upload path
// parse through the same call; the protocol allow-list check below still
// runs against the resolved URL.
function sanitizeImageUrl(url: string): string | null {
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    // Render a genuine root-relative path (`/api/uploads/image/<id>`) with
    // the original literal string, not `parsed.href` — a bare path needs no
    // browser-support work as an <img src>. Guarded to single-slash-prefixed
    // inputs that still resolve to *this page's own origin*: a
    // protocol-relative/backslash-smuggled value like "//evil.com/x" also
    // starts with "/" but resolves (via the base URL's protocol) to a
    // different origin — that falls through to the plain `parsed.href`
    // branch below instead, which is exactly the same "any absolute
    // http(s) URL is accepted" behavior already in place for a typed
    // external URL, so no new host is trusted here.
    if (url.startsWith("/") && !url.startsWith("//") && parsed.origin === window.location.origin) {
      return url;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

export function ImagePanel({ imageUrl, imageFit, caption }: ImagePanelProps) {
  const safeUrl = imageUrl ? sanitizeImageUrl(imageUrl) : null;
  const trimmedCaption = caption?.trim();
  const objectFit = (imageFit ?? "contain") as CSSProperties["objectFit"];

  // F-112: a broken/unreachable image URL used to leave the browser's native broken-image glyph
  // on screen indefinitely. Swap to the same placeholder markup the "no URL set" case already
  // uses, with copy specific to a load failure. Resets whenever the URL itself changes, so a
  // previously-broken image gets a fresh chance once the user points it somewhere new — adjusted
  // during render (React's documented pattern for "reset state when a prop changes"), not in an
  // effect, since this repo's eslint config flags synchronous setState-in-effect as an error.
  const [hasLoadError, setHasLoadError] = useState(false);
  const [lastSeenUrl, setLastSeenUrl] = useState(safeUrl);
  if (safeUrl !== lastSeenUrl) {
    setLastSeenUrl(safeUrl);
    setHasLoadError(false);
  }

  const visual =
    safeUrl && !hasLoadError ? (
      <div className="image-panel">
        <img
          className="image-panel__img"
          src={safeUrl}
          alt=""
          style={{ objectFit }}
          onError={() => setHasLoadError(true)}
        />
      </div>
    ) : (
      <div className="image-panel image-panel--empty">
        <span className="image-panel__placeholder-icon" aria-hidden="true">
          <FontAwesomeIcon icon={faImage} />
        </span>
        <span className="image-panel__placeholder-text">
          {safeUrl
            ? "Image failed to load. Check the URL in panel settings."
            : "No image URL set. Open panel settings to configure."}
        </span>
      </div>
    );

  return (
    <div className="image-panel-frame">
      {visual}
      {trimmedCaption ? (
        <p className="image-panel__caption" title={trimmedCaption}>
          {trimmedCaption}
        </p>
      ) : null}
    </div>
  );
}
