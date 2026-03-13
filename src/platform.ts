import {
  type AuditEntry,
  type CreateTaskInput,
  type MessageEnvelope,
  type PlatformEvent,
  type PullRequestRecord,
  type ReviewRecord,
  type Task,
  type TaskStatus,
  allowedDirectTransitions,
} from "./domain.js";
import { createInMemoryRepositories, type PlatformRepositories } from "./repositories.js";

type StatusUpdateInput = {
  status: TaskStatus;
  syncConfirmed?: boolean;
};

type RegisterPullRequestInput = Omit<
  PullRequestRecord,
  "status" | "autoMergeFrozen" | "reviewApproved" | "humanApproved" | "createdAt" | "updatedAt"
>;
type RegisterReviewInput = Omit<ReviewRecord, "createdAt">;

type GitHubWebhookPayload = {
  action: string;
  pull_request: {
    number: number;
    merged?: boolean;
    mergeable_state?: string;
  };
};

const devAgentTypes = new Set(["frontend_agent", "backend_agent"]);

export class CollaborationPlatform {
  constructor(private readonly repositories: PlatformRepositories = createInMemoryRepositories()) {}

  createTask(input: CreateTaskInput): Task {
    const now = new Date().toISOString();
    const task: Task = {
      id: input.id,
      title: input.title,
      parentId: input.parentId,
      featureId: input.featureId,
      ownerAgentType: input.ownerAgentType,
      taskKind: input.taskKind,
      dependsOn: input.dependsOn ?? [],
      contractRefs: input.contractRefs ?? [],
      repo: input.repo,
      riskLevel: input.riskLevel,
      status: input.status ?? this.defaultStatusForTask(input),
      blockReason: undefined,
      contractVersion: input.contractVersion,
      contractId: input.contractId,
      createdAt: now,
      updatedAt: now,
    };

    this.repositories.tasks.save(task);
    this.audit("task.created", "task", task.id, { status: task.status, taskKind: task.taskKind });
    this.emit("task.created", { taskId: task.id, payload: { status: task.status } });

    if (task.contractId) {
      this.repositories.contracts.save({
        id: task.contractId,
        featureId: task.featureId,
        taskId: task.id,
        version: task.contractVersion ?? 1,
        status: task.status === "contract_merged" ? "merged" : "pending",
        latestMergedVersion: task.status === "contract_merged" ? task.contractVersion ?? 1 : undefined,
        activePullRequestId: undefined,
        reviewApproved: false,
        humanApproved: false,
        updatedAt: now,
      });
    }

    return task;
  }

  claimTask(taskId: string, agentId: string): Task {
    const task = this.requireTask(taskId);

    if (!this.canAgentStartDev(taskId, agentId)) {
      throw new Error(`Task ${taskId} cannot be claimed until its contract is merged and the task is dev_ready.`);
    }

    task.assigneeAgentId = agentId;
    task.status = "in_progress";
    task.updatedAt = new Date().toISOString();
    this.repositories.tasks.save(task);
    this.audit("task.claimed", "task", task.id, { agentId });
    this.emit("task.assigned", { taskId: task.id, payload: { agentId } });
    return task;
  }

  updateTaskStatus(taskId: string, input: StatusUpdateInput): Task {
    const task = this.requireTask(taskId);

    if (task.blockReason === "contract_amended" && input.status === "in_progress") {
      if (!input.syncConfirmed) {
        throw new Error(`Task ${taskId} requires contract sync confirmation before resuming.`);
      }

      task.blockReason = undefined;
      task.requiresContractSync = false;
      task.pendingResumptionStatus = undefined;
      task.status = "in_progress";
      task.updatedAt = new Date().toISOString();
      this.repositories.tasks.save(task);
      this.audit("task.resumed_after_contract_sync", "task", task.id, {
        contractVersion: task.contractVersion,
      });
      return task;
    }

    this.ensureTransition(task.status, input.status, task.id);
    task.status = input.status;
    task.updatedAt = new Date().toISOString();
    this.repositories.tasks.save(task);
    this.audit("task.status_updated", "task", task.id, { status: input.status });
    return task;
  }

  blockTask(taskId: string, reason: string): Task {
    const task = this.requireTask(taskId);
    task.status = "blocked";
    task.blockReason = reason;
    task.updatedAt = new Date().toISOString();
    this.repositories.tasks.save(task);
    this.audit("task.blocked", "task", task.id, { reason });
    this.emit("task.blocked", { taskId: task.id, payload: { reason } });
    return task;
  }

  getTaskContext(taskId: string) {
    const task = this.requireTask(taskId);
    const taskPullRequests = this.repositories.pullRequests.listByTaskId(taskId);
    const taskReviews = taskPullRequests.flatMap((pr) => this.repositories.reviews.listByPullRequestId(pr.id));

    return {
      task,
      contracts: task.contractRefs
        .map((contractId) => this.repositories.contracts.getById(contractId))
        .filter(Boolean),
      messages: this.repositories.messages.listByTaskId(taskId),
      pullRequests: taskPullRequests,
      reviews: taskReviews,
      events: this.repositories.events.listByTaskId(taskId),
      audits: this.repositories.audits.listByEntityId(taskId),
    };
  }

  postMessage(message: MessageEnvelope): MessageEnvelope {
    const task = this.requireTask(message.taskId);

    const existingByTask = this.repositories.messages.listByTaskId(task.id);
    const duplicate = existingByTask.find((entry) => entry.messageId === message.messageId);
    if (duplicate) {
      return duplicate;
    }

    this.repositories.messages.append(message);
    this.audit("message.posted", "message", message.messageId, {
      taskId: message.taskId,
      correlationId: message.correlationId,
      roundTripIndex: message.roundTripIndex,
    });

    if (this.shouldTripDeadlock(message.correlationId)) {
      task.status = "blocked";
      task.blockReason = "negotiation_deadlock";
      task.updatedAt = new Date().toISOString();
      this.repositories.tasks.save(task);
      this.emit("human.approval.required", {
        taskId: task.id,
        payload: { reason: "negotiation_deadlock", correlationId: message.correlationId },
      });
      this.audit("deadlock.tripped", "task", task.id, { correlationId: message.correlationId });
    }

    return message;
  }

  registerPullRequest(input: RegisterPullRequestInput): PullRequestRecord {
    const task = this.requireTask(input.taskId);
    const existingById = this.repositories.pullRequests.getById(input.id);
    if (existingById) {
      return existingById;
    }
    const existingByGithubNumber = this.repositories.pullRequests.getByGithubNumber(input.githubNumber);
    if (existingByGithubNumber) {
      return existingByGithubNumber;
    }

    const now = new Date().toISOString();
    const record: PullRequestRecord = {
      ...input,
      status: "open",
      autoMergeFrozen: false,
      reviewApproved: false,
      humanApproved: false,
      createdAt: now,
      updatedAt: now,
    };

    this.repositories.pullRequests.save(record);
    task.activePullRequestId = record.id;
    if (task.status === "in_progress" || task.status === "dev_ready") {
      task.status = "pr_opened";
    }
    task.updatedAt = now;
    this.repositories.tasks.save(task);

    if (record.kind === "contract" && record.contractId) {
      const contract = this.requireContract(record.contractId);
      const isAmendment = contract.latestMergedVersion !== undefined;
      contract.status = "in_review";
      contract.version = record.contractVersion ?? contract.version + 1;
      contract.activePullRequestId = record.id;
      contract.reviewApproved = false;
      contract.humanApproved = false;
      contract.updatedAt = now;

      task.status = "contract_in_review";
      this.repositories.contracts.save(contract);
      this.repositories.tasks.save(task);

      if (isAmendment) {
        this.cascadeBlockOnContractUpdate(contract.id, contract.version);
      }
    }

    this.audit("pull_request.registered", "pull_request", record.id, {
      taskId: record.taskId,
      kind: record.kind,
      githubNumber: record.githubNumber,
    });
    this.emit("pr.opened", { taskId: record.taskId, pullRequestId: record.id, payload: { kind: record.kind } });

    return record;
  }

  registerReview(input: RegisterReviewInput): ReviewRecord {
    const existingReview = this.repositories
      .reviews
      .listByPullRequestId(input.pullRequestId)
      .find((review) => review.id === input.id);
    if (existingReview) {
      return existingReview;
    }

    const review: ReviewRecord = {
      ...input,
      createdAt: new Date().toISOString(),
    };
    const pr = this.requirePullRequest(input.pullRequestId);
    const task = this.requireTask(pr.taskId);

    this.repositories.reviews.append(review);

    if (task.status === "pr_opened") {
      task.status = "under_review";
    }

    if (review.decision === "approved") {
      if (review.actorType === "review_agent") {
        pr.reviewApproved = true;
      }
      if (review.actorType === "human_approver") {
        pr.humanApproved = true;
      }
    }

    if (review.decision === "changes_requested") {
      task.status = "in_progress";
    }
    task.updatedAt = new Date().toISOString();
    this.repositories.tasks.save(task);
    this.repositories.pullRequests.save(pr);

    this.audit("review.registered", "review", review.id, {
      pullRequestId: pr.id,
      actorType: review.actorType,
      decision: review.decision,
    });
    this.emit("review.completed", {
      taskId: task.id,
      pullRequestId: pr.id,
      payload: { decision: review.decision, actorType: review.actorType },
    });

    return review;
  }

  handleGitHubWebhook(payload: GitHubWebhookPayload, deliveryId?: string) {
    if (deliveryId && this.repositories.webhookDeliveries.has(deliveryId)) {
      return { handled: true, duplicate: true };
    }

    const pr = this.repositories.pullRequests.getByGithubNumber(payload.pull_request.number);
    if (!pr) {
      return { handled: false };
    }

    const mergeableState = payload.pull_request.mergeable_state;
    if (mergeableState) {
      pr.mergeableState = mergeableState;
      pr.updatedAt = new Date().toISOString();
      this.repositories.pullRequests.save(pr);
    }

    if (mergeableState === "dirty") {
      this.shouldEscalateMergeConflict(pr.id);
    }

    if (payload.action === "closed" && payload.pull_request.merged) {
      if (pr.status === "merged") {
        if (deliveryId) {
          this.repositories.webhookDeliveries.save(deliveryId);
        }
        return { handled: true, duplicate: true, pullRequestId: pr.id };
      }
      this.markPullRequestMerged(pr.id);
    }

    if (deliveryId) {
      this.repositories.webhookDeliveries.save(deliveryId);
    }

    return { handled: true, pullRequestId: pr.id };
  }

  canAgentStartDev(taskId: string, _agentId: string): boolean {
    const task = this.requireTask(taskId);

    if (!devAgentTypes.has(task.ownerAgentType)) {
      return task.status !== "done";
    }

    if (task.status !== "dev_ready") {
      return false;
    }

    return task.contractRefs.every((contractId) => {
      const contract = this.requireContract(contractId);
      return contract.status === "merged" && contract.latestMergedVersion !== undefined;
    });
  }

  isContractMerged(featureId: string, contractVersion: number): boolean {
    return this.repositories.contracts.list().some(
      (contract) =>
        contract.featureId === featureId &&
        contract.latestMergedVersion === contractVersion &&
        contract.status === "merged",
    );
  }

  cascadeBlockOnContractUpdate(contractId: string, version: number): Task[] {
    const affected = this.repositories.tasks.listByContractRef(contractId).filter(
      (task) =>
        ["in_progress", "pr_opened", "under_review"].includes(task.status),
    );

    for (const task of affected) {
      task.pendingResumptionStatus = "in_progress";
      task.status = "blocked";
      task.blockReason = "contract_updating";
      task.requiresContractSync = true;
      task.updatedAt = new Date().toISOString();
      this.repositories.tasks.save(task);
      this.emit("contract_updating", {
        taskId: task.id,
        contractId,
        payload: { version, reason: "contract_updating" },
      });
      this.audit("contract.cascade_block", "task", task.id, { contractId, version });
    }

    return affected;
  }

  resumeTasksAfterContractMerge(contractId: string, version: number): Task[] {
    const affected = this.repositories.tasks
      .listByContractRef(contractId)
      .filter((task) => task.blockReason === "contract_updating");

    for (const task of affected) {
      task.blockReason = "contract_amended";
      task.contractVersion = version;
      task.requiresContractSync = true;
      task.updatedAt = new Date().toISOString();
      this.repositories.tasks.save(task);
      this.emit("contract_amended", {
        taskId: task.id,
        contractId,
        payload: { version, requiresSync: true },
      });
      this.audit("contract.resume_ready", "task", task.id, { contractId, version });
    }

    return affected;
  }

  shouldTripDeadlock(correlationId: string): boolean {
    const negotiationMessages = this.repositories.messages
      .listByCorrelationId(correlationId)
      .sort((left, right) => left.roundTripIndex - right.roundTripIndex);

    if (negotiationMessages.length === 0) {
      return false;
    }

    return negotiationMessages[negotiationMessages.length - 1]!.roundTripIndex >= 3;
  }

  shouldEscalateMergeConflict(prId: string): PullRequestRecord {
    const pr = this.requirePullRequest(prId);
    const task = this.requireTask(pr.taskId);

    if (pr.autoMergeFrozen && task.status === "awaiting_human" && task.blockReason === "merge_conflict") {
      return pr;
    }

    pr.autoMergeFrozen = true;
    pr.updatedAt = new Date().toISOString();
    task.status = "awaiting_human";
    task.blockReason = "merge_conflict";
    task.updatedAt = new Date().toISOString();
    this.repositories.pullRequests.save(pr);
    this.repositories.tasks.save(task);

    this.emit("human.approval.required", {
      taskId: task.id,
      pullRequestId: pr.id,
      payload: { reason: "merge_conflict" },
    });
    this.audit("merge_conflict.escalated", "pull_request", pr.id, { taskId: task.id });

    return pr;
  }

  canMergePr(prId: string): boolean {
    const pr = this.requirePullRequest(prId);
    const task = this.requireTask(pr.taskId);

    if (pr.autoMergeFrozen || pr.mergeableState === "dirty") {
      return false;
    }

    if (task.status === "awaiting_human" || task.status === "blocked") {
      return false;
    }

    if (pr.kind === "contract") {
      return pr.reviewApproved && pr.humanApproved;
    }

    if (task.riskLevel === "high" || task.riskLevel === "critical") {
      return pr.humanApproved;
    }

    return true;
  }

  listEvents(): PlatformEvent[] {
    return this.repositories.events.list();
  }

  listAudits(): AuditEntry[] {
    return this.repositories.audits.list();
  }

  listTasks(): Task[] {
    return this.repositories.tasks.list();
  }

  listPullRequests(): PullRequestRecord[] {
    return this.repositories.pullRequests.list();
  }

  private markPullRequestMerged(prId: string) {
    const pr = this.requirePullRequest(prId);
    const task = this.requireTask(pr.taskId);

    if (!this.canMergePr(pr.id)) {
      throw new Error(`Pull request ${pr.id} does not satisfy merge requirements.`);
    }

    pr.status = "merged";
    pr.updatedAt = new Date().toISOString();
    task.activePullRequestId = pr.id;

    if (pr.kind === "contract" && pr.contractId) {
      const contract = this.requireContract(pr.contractId);
      contract.status = "merged";
      contract.reviewApproved = pr.reviewApproved;
      contract.humanApproved = pr.humanApproved;
      contract.latestMergedVersion = pr.contractVersion ?? contract.version;
      contract.version = pr.contractVersion ?? contract.version;
      contract.updatedAt = new Date().toISOString();

      task.status = "contract_merged";
      task.contractVersion = contract.version;
      task.updatedAt = new Date().toISOString();
      this.repositories.contracts.save(contract);
      this.repositories.tasks.save(task);

      const newlyUnlocked = this.repositories.tasks.listByContractRef(contract.id).filter(
        (candidate) =>
          ["contract_pending", "contract_merged", "dev_ready"].includes(candidate.status) &&
          candidate.id !== task.id,
      );

      for (const candidate of newlyUnlocked) {
        candidate.status = "dev_ready";
        candidate.contractVersion = contract.version;
        candidate.blockReason = undefined;
        candidate.updatedAt = new Date().toISOString();
        this.repositories.tasks.save(candidate);
        this.emit("interface.changed", {
          taskId: candidate.id,
          contractId: contract.id,
          pullRequestId: pr.id,
          payload: { contractVersion: contract.version },
        });
      }

      this.resumeTasksAfterContractMerge(contract.id, contract.version);
    } else {
      task.status = "done";
      task.updatedAt = new Date().toISOString();
      this.repositories.tasks.save(task);
    }
    this.repositories.pullRequests.save(pr);

    this.audit("pull_request.merged", "pull_request", pr.id, { taskId: task.id });
    this.emit("merge.completed", { taskId: task.id, pullRequestId: pr.id, payload: { kind: pr.kind } });
  }

  private defaultStatusForTask(input: CreateTaskInput): TaskStatus {
    if (input.ownerAgentType === "pm_agent") {
      return "draft";
    }
    if (input.taskKind === "contract" || input.ownerAgentType === "architect_agent") {
      return "contract_pending";
    }
    if (devAgentTypes.has(input.ownerAgentType)) {
      return "contract_pending";
    }
    return "draft";
  }

  private ensureTransition(from: TaskStatus, to: TaskStatus, taskId: string) {
    if (!allowedDirectTransitions[from].includes(to)) {
      throw new Error(`Task ${taskId} cannot move from ${from} to ${to}.`);
    }
  }

  private requireTask(taskId: string): Task {
    const task = this.repositories.tasks.getById(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found.`);
    }
    return task;
  }

  private requireContract(contractId: string) {
    const contract = this.repositories.contracts.getById(contractId);
    if (!contract) {
      throw new Error(`Contract ${contractId} not found.`);
    }
    return contract;
  }

  private requirePullRequest(prId: string): PullRequestRecord {
    const pr = this.repositories.pullRequests.getById(prId);
    if (!pr) {
      throw new Error(`Pull request ${prId} not found.`);
    }
    return pr;
  }

  private audit(action: string, entityType: AuditEntry["entityType"], entityId: string, metadata: Record<string, unknown>) {
    const auditCount = this.repositories.audits.list().length + 1;
    this.repositories.audits.append({
      id: `${action}:${entityId}:${auditCount}`,
      action,
      entityType,
      entityId,
      metadata,
      createdAt: new Date().toISOString(),
    });
  }

  private emit(eventType: PlatformEvent["type"], input: Omit<PlatformEvent, "id" | "type" | "createdAt">) {
    const eventCount = this.repositories.events.list().length + 1;
    this.repositories.events.append({
      id: `${eventType}:${eventCount}`,
      type: eventType,
      taskId: input.taskId,
      contractId: input.contractId,
      pullRequestId: input.pullRequestId,
      payload: input.payload,
      createdAt: new Date().toISOString(),
    });
  }
}
