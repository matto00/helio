import type { CSSProperties } from "react";
import "./ImagePanel.css";

interface ImagePanelProps {
  imageUrl: string | null;
  imageFit: string | null;
}

function sanitizeImageUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

export function ImagePanel({ imageUrl, imageFit }: ImagePanelProps) {
  const safeUrl = imageUrl ? sanitizeImageUrl(imageUrl) : null;
  if (!safeUrl) {
    return (
      <div className="image-panel image-panel--empty">
        <span className="image-panel__placeholder-icon" aria-hidden="true">
          🖼
        </span>
        <span className="image-panel__placeholder-text">
          No image URL set. Open panel settings to configure.
        </span>
      </div>
    );
  }

  const objectFit = (imageFit ?? "contain") as CSSProperties["objectFit"];

  return (
    <div className="image-panel">
      <img className="image-panel__img" src={safeUrl} alt="" style={{ objectFit }} />
    </div>
  );
}
