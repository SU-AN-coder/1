import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

async function createTask(app: ReturnType<typeof buildApp>, payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/tasks",
    payload,
  });
}

describe("multi-agent collaboration platform", () => {
  it("blocks development claims until the contract is merged, then unlocks dependent tasks", async () => {
    const app = buildApp();

    await createTask(app, {
      id: "contract-task",
      title: "Define user profile contract",
      featureId: "feature-a",
      ownerAgentType: "architect_agent",
      taskKind: "contract",
      repo: "org/repo",
      riskLevel: "high",
      contractId: "contract-user-profile",
      contractVersion: 1,
    });

    await createTask(app, {
      id: "frontend-task",
      title: "Build profile screen",
      featureId: "feature-a",
      ownerAgentType: "frontend_agent",
      taskKind: "implementation",
      contractRefs: ["contract-user-profile"],
      repo: "org/repo",
      riskLevel: "medium",
    });

    const blockedClaim = await app.inject({
      method: "POST",
      url: "/tasks/frontend-task/claim",
      payload: { agentId: "frontend-local-1" },
    });
    expect(blockedClaim.statusCode).toBe(400);

    await app.inject({
      method: "POST",
      url: "/pull-requests/register",
      payload: {
        id: "pr-contract-1",
        githubNumber: 10,
        taskId: "contract-task",
        repo: "org/repo",
        kind: "contract",
        contractId: "contract-user-profile",
        contractVersion: 1,
      },
    });

    await app.inject({
      method: "POST",
      url: "/reviews/register",
      payload: {
        id: "review-1",
        pullRequestId: "pr-contract-1",
        actorType: "review_agent",
        actorId: "review-agent-1",
        decision: "approved",
      },
    });
    await app.inject({
      method: "POST",
      url: "/reviews/register",
      payload: {
        id: "review-2",
        pullRequestId: "pr-contract-1",
        actorType: "human_approver",
        actorId: "human-1",
        decision: "approved",
      },
    });

    const mergeResponse = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "closed",
        pull_request: {
          number: 10,
          merged: true,
          mergeable_state: "clean",
        },
      },
    });
    expect(mergeResponse.statusCode).toBe(200);

    const context = await app.inject({
      method: "GET",
      url: "/tasks/frontend-task/context",
    });
    expect(context.statusCode).toBe(200);
    const parsed = context.json();
    expect(parsed.task.status).toBe("dev_ready");
    expect(parsed.task.contractVersion).toBe(1);

    const claimResponse = await app.inject({
      method: "POST",
      url: "/tasks/frontend-task/claim",
      payload: { agentId: "frontend-local-1" },
    });
    expect(claimResponse.statusCode).toBe(200);
    expect(claimResponse.json().status).toBe("in_progress");
  });

  it("cascade-blocks downstream tasks when an amended contract enters review and resumes after sync", async () => {
    const app = buildApp();

    await createTask(app, {
      id: "contract-task",
      title: "Define API contract",
      featureId: "feature-a",
      ownerAgentType: "architect_agent",
      taskKind: "contract",
      repo: "org/repo",
      riskLevel: "high",
      contractId: "contract-api",
      contractVersion: 1,
      status: "contract_merged",
    });

    await createTask(app, {
      id: "backend-task",
      title: "Implement profile endpoint",
      featureId: "feature-a",
      ownerAgentType: "backend_agent",
      taskKind: "implementation",
      contractRefs: ["contract-api"],
      repo: "org/repo",
      riskLevel: "medium",
      status: "dev_ready",
      contractVersion: 1,
    });

    await app.inject({
      method: "POST",
      url: "/tasks/backend-task/claim",
      payload: { agentId: "backend-local-1" },
    });

    await app.inject({
      method: "POST",
      url: "/pull-requests/register",
      payload: {
        id: "pr-contract-2",
        githubNumber: 11,
        taskId: "contract-task",
        repo: "org/repo",
        kind: "contract",
        contractId: "contract-api",
        contractVersion: 2,
      },
    });

    const blockedContext = await app.inject({
      method: "GET",
      url: "/tasks/backend-task/context",
    });
    expect(blockedContext.json().task.status).toBe("blocked");
    expect(blockedContext.json().task.blockReason).toBe("contract_updating");

    await app.inject({
      method: "POST",
      url: "/reviews/register",
      payload: {
        id: "review-3",
        pullRequestId: "pr-contract-2",
        actorType: "review_agent",
        actorId: "review-agent-1",
        decision: "approved",
      },
    });
    await app.inject({
      method: "POST",
      url: "/reviews/register",
      payload: {
        id: "review-4",
        pullRequestId: "pr-contract-2",
        actorType: "human_approver",
        actorId: "human-1",
        decision: "approved",
      },
    });
    await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "closed",
        pull_request: {
          number: 11,
          merged: true,
          mergeable_state: "clean",
        },
      },
    });

    const amendedContext = await app.inject({
      method: "GET",
      url: "/tasks/backend-task/context",
    });
    expect(amendedContext.json().task.blockReason).toBe("contract_amended");
    expect(amendedContext.json().task.contractVersion).toBe(2);

    const resumeWithoutSync = await app.inject({
      method: "POST",
      url: "/tasks/backend-task/status",
      payload: { status: "in_progress" },
    });
    expect(resumeWithoutSync.statusCode).toBe(400);

    const resumeWithSync = await app.inject({
      method: "POST",
      url: "/tasks/backend-task/status",
      payload: { status: "in_progress", syncConfirmed: true },
    });
    expect(resumeWithSync.statusCode).toBe(200);
    expect(resumeWithSync.json().status).toBe("in_progress");
  });

  it("trips deadlock after three negotiation rounds", async () => {
    const app = buildApp();

    await createTask(app, {
      id: "contract-task",
      title: "Define API contract",
      ownerAgentType: "architect_agent",
      taskKind: "contract",
      repo: "org/repo",
      riskLevel: "high",
      contractId: "contract-api",
      contractVersion: 1,
      status: "contract_merged",
    });

    await createTask(app, {
      id: "frontend-task",
      title: "Frontend task",
      ownerAgentType: "frontend_agent",
      taskKind: "implementation",
      contractRefs: ["contract-api"],
      repo: "org/repo",
      riskLevel: "medium",
      status: "dev_ready",
      contractVersion: 1,
    });

    await app.inject({
      method: "POST",
      url: "/tasks/frontend-task/claim",
      payload: { agentId: "frontend-local-1" },
    });

    for (const roundTripIndex of [1, 2, 3]) {
      const response = await app.inject({
        method: "POST",
        url: "/messages",
        payload: {
          messageId: `msg-${roundTripIndex}`,
          taskId: "frontend-task",
          fromAgent: "frontend-local-1",
          toAgent: "backend-local-1",
          messageType: "negotiation_request",
          contextRefs: [{ type: "file_line", filePath: "src/api.ts", line: 42 }],
          requestedAction: "add avatar_url",
          correlationId: "corr-1",
          roundTripIndex,
          createdAt: new Date().toISOString(),
        },
      });
      expect(response.statusCode).toBe(201);
    }

    const context = await app.inject({
      method: "GET",
      url: "/tasks/frontend-task/context",
    });
    expect(context.json().task.status).toBe("blocked");
    expect(context.json().task.blockReason).toBe("negotiation_deadlock");
  });

  it("escalates merge conflicts to a human approver", async () => {
    const app = buildApp();

    await createTask(app, {
      id: "contract-task",
      title: "Contract",
      ownerAgentType: "architect_agent",
      taskKind: "contract",
      repo: "org/repo",
      riskLevel: "high",
      contractId: "contract-conflict",
      contractVersion: 1,
      status: "contract_merged",
    });

    await createTask(app, {
      id: "frontend-task",
      title: "Frontend implementation",
      ownerAgentType: "frontend_agent",
      taskKind: "implementation",
      contractRefs: ["contract-conflict"],
      repo: "org/repo",
      riskLevel: "high",
      status: "dev_ready",
      contractVersion: 1,
    });

    await app.inject({
      method: "POST",
      url: "/tasks/frontend-task/claim",
      payload: { agentId: "frontend-local-1" },
    });

    await app.inject({
      method: "POST",
      url: "/pull-requests/register",
      payload: {
        id: "pr-front-1",
        githubNumber: 12,
        taskId: "frontend-task",
        repo: "org/repo",
        kind: "implementation",
      },
    });

    const webhookResponse = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "synchronize",
        pull_request: {
          number: 12,
          mergeable_state: "dirty",
        },
      },
    });
    expect(webhookResponse.statusCode).toBe(200);

    const context = await app.inject({
      method: "GET",
      url: "/tasks/frontend-task/context",
    });
    expect(context.json().task.status).toBe("awaiting_human");
    expect(context.json().task.blockReason).toBe("merge_conflict");

    const canMerge = await app.inject({
      method: "GET",
      url: "/pull-requests/pr-front-1/can-merge",
    });
    expect(canMerge.json().canMerge).toBe(false);
  });

  it("treats duplicate pull request registration as idempotent", async () => {
    const app = buildApp();

    await createTask(app, {
      id: "contract-task",
      title: "Contract",
      ownerAgentType: "architect_agent",
      taskKind: "contract",
      repo: "org/repo",
      riskLevel: "high",
      contractId: "contract-idempotent",
      contractVersion: 1,
      status: "contract_merged",
    });

    await createTask(app, {
      id: "backend-task",
      title: "Backend implementation",
      ownerAgentType: "backend_agent",
      taskKind: "implementation",
      contractRefs: ["contract-idempotent"],
      repo: "org/repo",
      riskLevel: "medium",
      status: "dev_ready",
      contractVersion: 1,
    });

    await app.inject({
      method: "POST",
      url: "/tasks/backend-task/claim",
      payload: { agentId: "backend-local-1" },
    });

    const first = await app.inject({
      method: "POST",
      url: "/pull-requests/register",
      payload: {
        id: "pr-backend-1",
        githubNumber: 30,
        taskId: "backend-task",
        repo: "org/repo",
        kind: "implementation",
      },
    });
    const second = await app.inject({
      method: "POST",
      url: "/pull-requests/register",
      payload: {
        id: "pr-backend-1",
        githubNumber: 30,
        taskId: "backend-task",
        repo: "org/repo",
        kind: "implementation",
      },
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.json().id).toBe(second.json().id);

    const health = await app.inject({
      method: "GET",
      url: "/health",
    });
    expect(health.json().pullRequests).toBe(1);
  });

  it("ignores duplicate GitHub webhook deliveries", async () => {
    const app = buildApp();

    await createTask(app, {
      id: "contract-task",
      title: "Contract",
      ownerAgentType: "architect_agent",
      taskKind: "contract",
      repo: "org/repo",
      riskLevel: "high",
      contractId: "contract-webhook",
      contractVersion: 1,
    });

    await app.inject({
      method: "POST",
      url: "/pull-requests/register",
      payload: {
        id: "pr-contract-webhook",
        githubNumber: 31,
        taskId: "contract-task",
        repo: "org/repo",
        kind: "contract",
        contractId: "contract-webhook",
        contractVersion: 1,
      },
    });

    await app.inject({
      method: "POST",
      url: "/reviews/register",
      payload: {
        id: "review-webhook-1",
        pullRequestId: "pr-contract-webhook",
        actorType: "review_agent",
        actorId: "review-agent-1",
        decision: "approved",
      },
    });
    await app.inject({
      method: "POST",
      url: "/reviews/register",
      payload: {
        id: "review-webhook-2",
        pullRequestId: "pr-contract-webhook",
        actorType: "human_approver",
        actorId: "human-1",
        decision: "approved",
      },
    });

    const first = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      headers: {
        "x-github-delivery": "delivery-1",
      },
      payload: {
        action: "closed",
        pull_request: {
          number: 31,
          merged: true,
          mergeable_state: "clean",
        },
      },
    });
    const second = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      headers: {
        "x-github-delivery": "delivery-1",
      },
      payload: {
        action: "closed",
        pull_request: {
          number: 31,
          merged: true,
          mergeable_state: "clean",
        },
      },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().duplicate).toBe(true);

    const events = await app.inject({
      method: "GET",
      url: "/events",
    });
    const mergeEvents = events.json().filter((event: { type: string; pullRequestId?: string }) => {
      return event.type === "merge.completed" && event.pullRequestId === "pr-contract-webhook";
    });
    expect(mergeEvents).toHaveLength(1);
  });
});
