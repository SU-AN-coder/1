import Fastify from "fastify";
import { z } from "zod";
import { agentTypes, messageTypes, reviewDecisions, riskLevels, taskKinds, taskStatuses } from "./domain.js";
import { CollaborationPlatform } from "./platform.js";

const taskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  parentId: z.string().min(1).optional(),
  featureId: z.string().min(1).optional(),
  ownerAgentType: z.enum(agentTypes),
  taskKind: z.enum(taskKinds),
  dependsOn: z.array(z.string()).default([]),
  contractRefs: z.array(z.string()).default([]),
  repo: z.string().min(1),
  riskLevel: z.enum(riskLevels),
  status: z.enum(taskStatuses).optional(),
  contractVersion: z.number().int().positive().optional(),
  contractId: z.string().min(1).optional(),
});

const claimTaskSchema = z.object({
  agentId: z.string().min(1),
});

const updateTaskStatusSchema = z.object({
  status: z.enum(taskStatuses),
  syncConfirmed: z.boolean().optional(),
});

const blockTaskSchema = z.object({
  reason: z.string().min(1),
});

const contextRefSchema = z.object({
  type: z.enum([
    "repo_commit",
    "pull_request",
    "review_comment",
    "file_line",
    "openapi_path",
    "schema_version",
    "check_run",
    "task",
  ]),
  repo: z.string().optional(),
  branch: z.string().optional(),
  commitSha: z.string().optional(),
  pullRequestId: z.string().optional(),
  reviewCommentId: z.string().optional(),
  filePath: z.string().optional(),
  line: z.number().int().positive().optional(),
  openApiPath: z.string().optional(),
  schemaVersion: z.number().int().positive().optional(),
  checkRunId: z.string().optional(),
  taskId: z.string().optional(),
});

const messageSchema = z.object({
  messageId: z.string().min(1),
  taskId: z.string().min(1),
  fromAgent: z.string().min(1),
  toAgent: z.string().min(1),
  messageType: z.enum(messageTypes),
  contextRefs: z.array(contextRefSchema),
  requestedAction: z.string().min(1),
  expectedArtifact: z.string().optional(),
  correlationId: z.string().min(1),
  roundTripIndex: z.number().int().min(1).max(3),
  deadline: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
});

const pullRequestSchema = z.object({
  id: z.string().min(1),
  githubNumber: z.number().int().positive(),
  taskId: z.string().min(1),
  repo: z.string().min(1),
  kind: z.enum(["contract", "implementation"]),
  contractId: z.string().optional(),
  contractVersion: z.number().int().positive().optional(),
  url: z.string().url().optional(),
});

const reviewSchema = z.object({
  id: z.string().min(1),
  pullRequestId: z.string().min(1),
  actorType: z.enum(["review_agent", "human_approver", "test_agent"]),
  actorId: z.string().min(1),
  decision: z.enum(reviewDecisions),
  comment: z.string().optional(),
});

const githubWebhookSchema = z.object({
  action: z.string(),
  pull_request: z.object({
    number: z.number().int().positive(),
    merged: z.boolean().optional(),
    mergeable_state: z.string().optional(),
  }),
});

export function buildApp(platform = new CollaborationPlatform()) {
  const app = Fastify({ logger: false });

  app.get("/health", async () => ({
    ok: true,
    tasks: platform.listTasks().length,
    pullRequests: platform.listPullRequests().length,
  }));

  app.post("/tasks", async (request, reply) => {
    const task = platform.createTask(taskSchema.parse(request.body));
    reply.code(201);
    return task;
  });

  app.post("/tasks/:id/claim", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = claimTaskSchema.parse(request.body);
    return platform.claimTask(params.id, body.agentId);
  });

  app.post("/tasks/:id/status", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = updateTaskStatusSchema.parse(request.body);
    return platform.updateTaskStatus(params.id, body);
  });

  app.post("/tasks/:id/block", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = blockTaskSchema.parse(request.body);
    return platform.blockTask(params.id, body.reason);
  });

  app.get("/tasks/:id/context", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    return platform.getTaskContext(params.id);
  });

  app.post("/messages", async (request, reply) => {
    const message = platform.postMessage(messageSchema.parse(request.body));
    reply.code(201);
    return message;
  });

  app.post("/pull-requests/register", async (request, reply) => {
    const pr = platform.registerPullRequest(pullRequestSchema.parse(request.body));
    reply.code(201);
    return pr;
  });

  app.post("/reviews/register", async (request, reply) => {
    const review = platform.registerReview(reviewSchema.parse(request.body));
    reply.code(201);
    return review;
  });

  app.post("/webhooks/github", async (request) => {
    const deliveryIdHeader = request.headers["x-github-delivery"];
    const deliveryId = Array.isArray(deliveryIdHeader) ? deliveryIdHeader[0] : deliveryIdHeader;
    return platform.handleGitHubWebhook(githubWebhookSchema.parse(request.body), deliveryId);
  });

  app.get("/pull-requests/:id/can-merge", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    return { canMerge: platform.canMergePr(params.id) };
  });

  app.get("/events", async () => platform.listEvents());
  app.get("/audits", async () => platform.listAudits());

  app.setErrorHandler((error, _request, reply) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    reply.code(400).send({
      error: message,
    });
  });

  return app;
}
