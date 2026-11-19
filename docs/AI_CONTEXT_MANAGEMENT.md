# AI context management

Implemented in Phase 6. The context layer sits between PostgreSQL, Nexconn, Cloudinary, and Groq. Groq is not the memory store.

## Ownership

- PostgreSQL stores versioned incident snapshots, batch summaries (`ConversationBatchSummary` every 100 messages), assistant sessions, and source references.
- Nexconn stores chat messages. `message:send` webhook metadata is the server-side index. The open workspace can still read recent messages through Chat UI.
- Cloudinary stores evidence media. Chat media stays on Nexconn Helper uploads.
- Redis and BullMQ serialize context refresh jobs per incident.

## Retrieval

A question is answered only after session, membership, and incident access checks. The package sent to Groq includes the incident, the latest valid snapshot, batch summaries, recent message index rows, and timeline events. Chat text is data, not instructions.

Snapshots keep a version, a watermark (latest incident event and last processed message id), a status, and source references. Assistant threads are private. Freshness compares the watermark with newer events and messages.

There is no vector database in the MVP.
