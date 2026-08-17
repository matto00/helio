-- HEL-698: client-side send-retry idempotency for assistant conversations.
--
-- `last_idempotency_key` records the key of the most recent KEYED append
-- (converse or /messages) on the conversation. A keyless append leaves this
-- column untouched (design.md D2) -- nulling it there would let an unrelated
-- keyless append silently un-protect an outstanding keyed retry. Nullable:
-- absent until the first keyed append ever occurs.

ALTER TABLE assistant_conversations ADD COLUMN last_idempotency_key TEXT NULL;
