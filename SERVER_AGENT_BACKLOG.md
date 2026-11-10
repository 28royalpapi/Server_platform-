# Server Remote Agent Backlog

This is the durable task queue for the remote engineering worker. The owner can add one task per unchecked item. Tasks are processed from top to bottom, one per worker run.

## Status rules

- `- [ ]` — queued and eligible.
- `- [x]` — completed with evidence recorded in the work journal.
- `- [~]` — blocked; skipped until the owner changes it back to `- [ ]`.

## Queued tasks

No product task is queued yet. The owner will provide the next Server task after the remote-agent bootstrap is reviewed and activated.

## How to queue work

Add a specific unchecked task here on the default branch, or dispatch the `Server Remote Agent` GitHub Actions workflow with a task description. Do not put secrets, OTPs, phone numbers, or private user data in this file.