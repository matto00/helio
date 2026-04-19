import { useState } from "react";

import "./ComputedFieldsEditor.css";
import type { ComputedField } from "../types/models";
import { ComputedFieldForm } from "./ComputedFieldForm";

interface ComputedFieldsEditorProps {
  typeId: string;
  computedFields: ComputedField[];
  onChange: (newFields: ComputedField[]) => void;
}

type EditorState = { mode: "list" } | { mode: "add" } | { mode: "edit"; index: number };

export function ComputedFieldsEditor({
  typeId,
  computedFields,
  onChange,
}: ComputedFieldsEditorProps) {
  const [editorState, setEditorState] = useState<EditorState>({ mode: "list" });

  function handleAdd(field: ComputedField) {
    onChange([...computedFields, field]);
    setEditorState({ mode: "list" });
  }

  function handleEdit(index: number, field: ComputedField) {
    const next = computedFields.map((f, i) => (i === index ? field : f));
    onChange(next);
    setEditorState({ mode: "list" });
  }

  function handleRemove(index: number) {
    onChange(computedFields.filter((_, i) => i !== index));
  }

  return (
    <section className="computed-fields-editor" aria-label="Computed fields">
      <div className="computed-fields-editor__header">
        <h4 className="computed-fields-editor__title">Computed fields</h4>
        {editorState.mode === "list" && (
          <button
            type="button"
            className="computed-fields-editor__add-btn"
            onClick={() => setEditorState({ mode: "add" })}
            aria-label="Add computed field"
          >
            + Add
          </button>
        )}
      </div>

      {computedFields.length > 0 && editorState.mode === "list" && (
        <ul className="computed-fields-editor__list" aria-label="Computed fields list">
          {computedFields.map((field, index) => (
            <li key={field.name} className="computed-fields-editor__item">
              <span className="computed-fields-editor__field-name">
                {field.displayName || field.name}
              </span>
              <span className="computed-fields-editor__field-expr">{field.expression}</span>
              <span className="computed-fields-editor__field-type computed-badge">computed</span>
              <div className="computed-fields-editor__item-actions">
                <button
                  type="button"
                  className="computed-fields-editor__edit-btn"
                  onClick={() => setEditorState({ mode: "edit", index })}
                  aria-label={`Edit computed field ${field.name}`}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="computed-fields-editor__remove-btn"
                  onClick={() => handleRemove(index)}
                  aria-label={`Remove computed field ${field.name}`}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {computedFields.length === 0 && editorState.mode === "list" && (
        <p className="computed-fields-editor__empty">No computed fields defined.</p>
      )}

      {editorState.mode === "add" && (
        <ComputedFieldForm
          typeId={typeId}
          onSave={handleAdd}
          onCancel={() => setEditorState({ mode: "list" })}
        />
      )}

      {editorState.mode === "edit" && (
        <ComputedFieldForm
          typeId={typeId}
          initial={computedFields[editorState.index]}
          onSave={(field) => handleEdit(editorState.index, field)}
          onCancel={() => setEditorState({ mode: "list" })}
        />
      )}
    </section>
  );
}
