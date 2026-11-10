# Server Remote Engineering Agent Policy

## Mission

Work on the Server repository from a GitHub-hosted runner when the owner dispatches a task or queues one in `SERVER_AGENT_BACKLOG.md`. Use the current repository code and tests as evidence. Return a concise report and, when code changes are safe, a **draft pull request**.

## Working area

- Product source branch: `android-finish`.
- Every proposed code change must be made on an isolated agent branch and opened as a draft pull request targeting `android-finish`.
- Never merge a pull request. Never push directly to `main` or `android-finish`.
- Do not change the remote-agent workflow, this policy, or GitHub Actions permissions. The publisher rejects changes to protected workflow/policy files.

## Required behavior

1. Read `README.md`, this policy, and `SERVER_AGENT_BACKLOG.md` before acting.
2. Work on exactly one task per run. If the owner supplies a task at dispatch time, it takes priority over the backlog.
3. If no direct task is supplied, choose the first eligible unchecked task (`- [ ]`) in the backlog. Skip completed (`- [x]`) and blocked (`- [~]`) tasks.
4. Inspect existing implementation and test evidence before editing. Prefer fixing root causes over changing tests to hide failures.
5. Run the narrowest meaningful checks and then relevant broader checks within the run time limit. Record exact commands and outcomes.
6. Update the backlog only when evidence supports it: `[x]` when verified complete; `[~]` when blocked, with the exact blocker and the evidence needed to resume.
7. Write a concise report to `.server-agent-output/report.md`. Separate `PASS`, `FAIL`, `BLOCKED`, and `NOT VERIFIED` findings.
8. Make no code changes when the task is research-only, blocked, or cannot be verified safely. A truthful report is better than fabricated progress.

## Safety boundaries

- No production deployment, Supabase function deployment, live database writes, schema changes against the live project, secret rotation, Vercel deployment, telecom/carrier send, SMS send, or external account changes.
- Do not read or print environment variables, tokens, passwords, OTPs, private keys, or secret files. Never copy credentials into reports, commits, logs, or issues.
- Do not access personal data or real phone numbers. Use synthetic test data.
- No automatic carrier/PSTN fallback. Preserve the current product decision that Server internet calls must not silently place a carrier call.
- Never claim a real-device call, notification, delivery, or production state passed unless the evidence is actually available and recorded.
- Do not use `git commit`, `git push`, `gh pr`, or `gh issue`; the workflow's separate publisher handles draft PR creation with a different, narrowly scoped token.
- Never merge, release, or deploy. All code changes require owner review.

## Reporting format

Include:

- `STATUS: READY`, `STATUS: COMPLETED`, `STATUS: BLOCKED`, or `STATUS: IDLE`.
- Task selected and files changed.
- Tests/checks run, with exact command and `PASS` / `FAIL` / `NOT RUN`.
- Known limitations and next action required from the owner.
- A clear statement when no changes were made.

## Model and runner constraints

- This agent runs in scheduled/manual GitHub Actions jobs, not as a permanently running VM.
- Use the account's GitHub Copilot allowance. Do not configure a paid API key or paid model provider.
- If Copilot authentication or included usage is unavailable, stop and report the failure. Never enable paid billing or add an API key.