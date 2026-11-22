## ADDED Requirements

### Requirement: Removing a conversation object leaves no empty per-user folder

When the local storage backend deletes an object, it SHALL also remove each directory that delete left empty, walking
upward from the object's directory and stopping before the top-level family directory under the uploads root; it
SHALL never remove the uploads root or a family directory, and SHALL leave any directory that still holds an entry. A
concurrent write into a directory being removed SHALL still succeed.

#### Scenario: Deleting a user who has a conversation leaves no folder for that user

- **WHEN** a user who has an assistant conversation is deleted from the database and the stored-object drain runs over
  the local storage backend
- **THEN** neither the conversation file nor the `assistant-conversations/<userId>` folder exists, and the
  `assistant-conversations` directory still exists

#### Scenario: A folder still holding another object is kept

- **WHEN** one of a user's two conversations is deleted and drained
- **THEN** the other conversation's file and the user's folder remain

#### Scenario: Flat family directories are kept

- **WHEN** the last object in a flat family directory (for example `images/`) is deleted
- **THEN** that family directory still exists
