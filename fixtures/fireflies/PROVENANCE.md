# Fireflies fixtures — provenance

Hand-written from https://docs.fireflies.ai/graphql-api/webhooks and the
transcript query reference. **Not captured from a live account**, so there is no
real meeting content, no real participant names, and no real email addresses.
Every id, name, and address below is synthetic. This repo is public.

## What the docs establish

- Webhook payload is metadata ONLY: `{ meetingId, eventType, clientReferenceId }`
- `meetingId` and `transcriptId` are the same value
- Signature header is `x-hub-signature` — **no `-256` suffix**, `sha256=` prefix
- Retry behaviour is **undocumented**
