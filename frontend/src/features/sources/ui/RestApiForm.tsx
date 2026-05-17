// REST API source configuration fields (URL + optional JSON path) rendered
// inside AddSourceModal when the user picks the REST API source type.
//
// Extracted from AddSourceModal.tsx in CS3 cycle 2 (behavior-preserving).

import { TextField } from "../../../shared/ui/TextField";

interface RestApiFormProps {
  url: string;
  jsonPath: string;
  onUrlChange: (value: string) => void;
  onJsonPathChange: (value: string) => void;
}

export function RestApiForm({ url, jsonPath, onUrlChange, onJsonPathChange }: RestApiFormProps) {
  return (
    <>
      <div className="add-source-modal__field">
        <label className="add-source-modal__label" htmlFor="source-url">
          URL
        </label>
        <TextField
          id="source-url"
          type="url"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder="https://api.example.com/data"
          aria-label="URL"
        />
      </div>
      <div className="add-source-modal__field">
        <label className="add-source-modal__label" htmlFor="source-json-path">
          JSON path <span className="add-source-modal__optional">(optional)</span>
        </label>
        <TextField
          id="source-json-path"
          value={jsonPath}
          onChange={(e) => onJsonPathChange(e.target.value)}
          placeholder="e.g. data.items"
          aria-label="JSON path"
        />
      </div>
    </>
  );
}
