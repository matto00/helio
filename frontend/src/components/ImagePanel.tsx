import type { CSSProperties } from "react";
import "./ImagePanel.css";

interface ImagePanelProps {
  imageUrl: string | null;
  imageFit: string | null;
}

function isSafeUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

export function ImagePanel({ imageUrl, imageFit }: ImagePanelProps) {
  const safeUrl = imageUrl && isSafeUrl(imageUrl) ? imageUrl : null;
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
