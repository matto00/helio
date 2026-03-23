import { useState } from "react";

import "./TypeRegistryBrowser.css";
import { useAppSelector } from "../hooks/reduxHooks";
import type { DataType } from "../types/models";
import { TypeDetailPanel } from "./TypeDetailPanel";

export function TypeRegistryBrowser() {
  const { items } = useAppSelector((state) => state.dataTypes);
  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null);

  const selectedType = items.find((dt) => dt.id === selectedTypeId) ?? null;

  if (items.length === 0) {
    return (
      <p className="type-registry-browser__empty">No data types yet. Add a source to create one.</p>
    );
  }

  return (
    <div className="type-registry-browser">
      <ul className="type-registry-browser__list" aria-label="Data types">
        {items.map((dt: DataType) => (
          <li
            key={dt.id}
            className={
              dt.id === selectedTypeId
                ? "type-registry-browser__item type-registry-browser__item--selected"
                : "type-registry-browser__item"
            }
          >
            <button
              type="button"
              className="type-registry-browser__item-btn"
              aria-pressed={dt.id === selectedTypeId}
              onClick={() => setSelectedTypeId((prev) => (prev === dt.id ? null : dt.id))}
            >
              <span className="type-registry-browser__item-name">{dt.name}</span>
              <span className="type-registry-browser__item-count">
                {dt.fields.length} field{dt.fields.length !== 1 ? "s" : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {selectedType && (
        <TypeDetailPanel dataType={selectedType} onClose={() => setSelectedTypeId(null)} />
      )}
    </div>
  );
}
