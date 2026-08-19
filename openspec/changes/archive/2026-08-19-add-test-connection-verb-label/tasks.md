## 1. Frontend

- [x] 1.1 Add a `test_connection: "Verifying connection"` entry to `VERB_BY_TOOL_NAME` in
      `frontend/src/features/assistant/ui/ToolCallIndicator.tsx`

## 2. Tests

- [x] 2.1 Add/extend a test in `frontend/src/features/assistant/ui/ToolCallIndicator.test.tsx`
      asserting a `test_connection` tool_use renders the "Verifying connection" verb, not the
      generic "Calling" fallback
