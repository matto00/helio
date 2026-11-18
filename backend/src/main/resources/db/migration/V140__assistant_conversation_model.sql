-- HEL-1755: the conversation's selected Claude model id (null = the server default at send time).
ALTER TABLE assistant_conversations ADD COLUMN model TEXT NULL;
