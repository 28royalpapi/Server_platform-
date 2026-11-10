# Server Remote Agent Backlog

This is the durable task queue for the remote engineering worker. The owner can add one task per unchecked item. Tasks are processed from top to bottom, one per worker run.

## Status rules

- `- [ ]` — queued and eligible.
- `- [x]` — completed with evidence recorded in the work journal.
- `- [~]` — blocked; skipped until the owner changes it back to `- [ ]`.

## Queued tasks

### P0 — Restore guest browser push setup

- [ ] Investigate and fix the guest browser Web Push setup failure reported as `503 GUEST_PUSH_CONFIGURATION_UNAVAILABLE`. Trace `push_config` from the guest web client through `server-guest` and VAPID key generation/storage. Inspect the current `android-finish` source and migrations first. Add regression tests for first-time VAPID configuration, concurrent initialization, missing/invalid configuration, and subscription registration. Preserve the no-SMS/no-carrier-fallback rule. Do not deploy Edge Functions, write to the live Supabase database, change production secrets, or send real notifications. If the failure depends on live Supabase secrets or project configuration that cannot be verified safely, stop and report the precise owner action required.

## How to queue work

Add a specific unchecked task here on the default branch, or dispatch the `Server Remote Agent` GitHub Actions workflow with a task description. Do not put secrets, OTPs, phone numbers, or private user data in this file.