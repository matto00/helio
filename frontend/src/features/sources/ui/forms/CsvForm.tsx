// CSV source configuration field (file upload) rendered inside
// AddSourceModal when the user picks the CSV source type.
//
// Extracted from AddSourceModal.tsx in CS3 cycle 2 (behavior-preserving).

import type { ChangeEvent } from "react";

interface CsvFormProps {
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
}

export function CsvForm({ onFileChange }: CsvFormProps) {
  return (
    <div className="add-source-modal__field">
      <label className="add-source-modal__label" htmlFor="source-csv-file">
        CSV file
      </label>
      <input
        id="source-csv-file"
        type="file"
        className="add-source-modal__input"
        accept=".csv,text/csv"
        onChange={onFileChange}
      />
    </div>
  );
}
