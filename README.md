# Multi-Agent Collaboration Platform MVP

An in-memory TypeScript implementation of the orchestration layer described in the plan:

- Contract-gated task state machine
- Contract amendment cascade blocking
- Structured message hub with 3-round deadlock protection
- GitHub webhook adapter for PR merge/conflict handling
- Repository pattern for storage backends
- Webhook idempotency via `x-github-delivery`
- Audit trail and event log

## Run

```bash
npm install
npm run dev
```

The server starts on `http://localhost:3000`.

## Main API

- `POST /tasks`
- `POST /tasks/:id/claim`
- `POST /tasks/:id/status`
- `POST /tasks/:id/block`
- `GET /tasks/:id/context`
- `POST /messages`
- `POST /pull-requests/register`
- `POST /reviews/register`
- `POST /webhooks/github`
- `GET /pull-requests/:id/can-merge`

## Notes

- The platform uses in-memory storage to keep the MVP easy to run locally.
- `src/repositories.ts` is the seam for swapping in PostgreSQL/Redis-backed implementations later.
- `src/repo-context-tool.ts` provides the minimum local context assembly primitive expected from a local agent client.
- Git conflicts are escalated to humans in the MVP and freeze auto-merge.
- Operator setup steps are documented in `OPERATOR_SETUP_GUIDE.md`.
