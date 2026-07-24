// Source-type toggle row inside AddSourceModal — one button per registered
// connector kind, one marked active. Used by both the configure form and the
// static-source variant of the modal.
//
// Extracted from AddSourceModal.tsx in CS3 cycle 2 (behavior-preserving:
// markup and class names are unchanged from the inlined originals).
//
// HEL-484: driven by GET /api/connectors (via `listConnectors`) rather than a
// hardcoded button list. `FALLBACK_CONNECTORS` mirrors the pre-registry
// hardcoded list byte-for-byte — the initial render (and the render if the
// fetch ever fails) so the toggle never flashes empty and never regresses.
// The registry's entry order/labels are designed (design.md Decision 6) to
// match this fallback exactly, so once the fetch resolves the rendered
// buttons are unchanged for the 7 current kinds.

import { useEffect, useState } from "react";

import { listConnectors, type ConnectorMetadata } from "../services/connectorService";

type SourceType = "rest_api" | "csv" | "static" | "sql" | "text" | "pdf" | "image";

interface SourceTypeToggleProps {
  active: SourceType;
  onChange: (next: SourceType) => void;
}

const FALLBACK_CONNECTORS: ConnectorMetadata[] = [
  {
    kind: "rest_api",
    displayName: "REST API",
    supportsIncremental: false,
    authKind: "configurable",
    requiredFields: [],
  },
  {
    kind: "csv",
    displayName: "CSV File",
    supportsIncremental: false,
    authKind: "none",
    requiredFields: [],
  },
  {
    kind: "static",
    displayName: "Manual",
    supportsIncremental: false,
    authKind: "none",
    requiredFields: [],
  },
  {
    kind: "sql",
    displayName: "SQL Database",
    supportsIncremental: false,
    authKind: "basic",
    requiredFields: [],
  },
  {
    kind: "text",
    displayName: "Text/Markdown",
    supportsIncremental: false,
    authKind: "none",
    requiredFields: [],
  },
  {
    kind: "pdf",
    displayName: "PDF",
    supportsIncremental: false,
    authKind: "none",
    requiredFields: [],
  },
  {
    kind: "image",
    displayName: "Image",
    supportsIncremental: false,
    authKind: "none",
    requiredFields: [],
  },
];

export function SourceTypeToggle({ active, onChange }: SourceTypeToggleProps) {
  const [connectors, setConnectors] = useState<ConnectorMetadata[]>(FALLBACK_CONNECTORS);

  useEffect(() => {
    let cancelled = false;
    listConnectors()
      .then((entries) => {
        if (!cancelled && entries.length > 0) setConnectors(entries);
      })
      .catch(() => {
        // Keep FALLBACK_CONNECTORS — never regress the toggle on a fetch failure.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="add-source-modal__field">
      <span className="add-source-modal__label">Source type</span>
      <div className="add-source-modal__type-toggle" role="group" aria-label="Source type">
        {connectors.map((connector) => (
          <button
            key={connector.kind}
            type="button"
            className={
              active === connector.kind
                ? "add-source-modal__type-btn add-source-modal__type-btn--active"
                : "add-source-modal__type-btn"
            }
            // `connector.kind` is validated server-side against the same 7-kind
            // set SourceType enumerates (ConnectorRegistrySpec pins this) — safe
            // to narrow here without a runtime guard.
            onClick={() => onChange(connector.kind as SourceType)}
          >
            {connector.displayName}
          </button>
        ))}
      </div>
    </div>
  );
}
