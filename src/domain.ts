export const taskStatuses = [
  "draft",
  "prd_ready",
  "contract_pending",
  "contract_in_review",
  "contract_merged",
  "dev_ready",
  "in_progress",
  "pr_opened",
  "under_review",
  "blocked",
  "awaiting_human",
  "done",
] as const;

export type TaskStatus = (typeof taskStatuses)[number];

export const riskLevels = ["low", "medium", "high", "critical"] as const;
export type RiskLevel = (typeof riskLevels)[number];

export const agentTypes = [
  "pm_agent",
  "architect_agent",
  "frontend_agent",
  "backend_agent",
  "test_agent",
  "review_agent",
  "human_approver",
  "maintainer_agent",
] as const;
export type AgentType = (typeof agentTypes)[number];

export const taskKinds = ["epic", "feature", "task", "subtask", "contract", "implementation"] as const;
export type TaskKind = (typeof taskKinds)[number];

export const messageTypes = [
  "negotiation_request",
  "negotiation_response",
  "artifact_request",
  "artifact_response",
  "clarification_request",
  "clarification_response",
] as const;
export type MessageType = (typeof messageTypes)[number];

export const reviewDecisions = ["approved", "changes_requested", "commented"] as const;
export type ReviewDecision = (typeof reviewDecisions)[number];

export const actorTypes = ["review_agent", "human_approver", "test_agent"] as const;
export type ReviewActorType = (typeof actorTypes)[number];

export const allowedDirectTransitions: Record<TaskStatus, TaskStatus[]> = {
  draft: ["prd_ready", "contract_pending"],
  prd_ready: ["contract_pending", "done"],
  contract_pending: ["contract_in_review", "blocked"],
  contract_in_review: ["contract_merged", "blocked", "awaiting_human"],
  contract_merged: ["dev_ready", "done"],
  dev_ready: ["in_progress", "blocked"],
  in_progress: ["pr_opened", "blocked", "awaiting_human", "done"],
  pr_opened: ["under_review", "blocked", "awaiting_human", "done"],
  under_review: ["done", "blocked", "awaiting_human", "in_progress"],
  blocked: ["dev_ready", "in_progress", "awaiting_human", "done"],
  awaiting_human: ["blocked", "in_progress", "done"],
  done: [],
};

export interface Task {
  id: string;
  title: string;
  parentId?: string;
  featureId?: string;
  ownerAgentType: AgentType;
  taskKind: TaskKind;
  dependsOn: string[];
  contractRefs: string[];
  repo: string;
  riskLevel: RiskLevel;
  status: TaskStatus;
  blockReason?: string;
  contractVersion?: number;
  contractId?: string;
  assigneeAgentId?: string;
  activePullRequestId?: string;
  pendingResumptionStatus?: Extract<TaskStatus, "in_progress">;
  requiresContractSync?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ContractRecord {
  id: string;
  featureId?: string;
  taskId: string;
  version: number;
  status: "pending" | "in_review" | "merged";
  latestMergedVersion?: number;
  activePullRequestId?: string;
  reviewApproved: boolean;
  humanApproved: boolean;
  updatedAt: string;
}

export interface PlatformEvent {
  id: string;
  type:
    | "task.created"
    | "task.assigned"
    | "task.blocked"
    | "interface.changed"
    | "contract_updating"
    | "contract_amended"
    | "pr.opened"
    | "review.requested"
    | "review.completed"
    | "human.approval.required"
    | "merge.completed";
  taskId?: string;
  contractId?: string;
  pullRequestId?: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: "task" | "contract" | "message" | "pull_request" | "review";
  entityId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ContextRef {
  type:
    | "repo_commit"
    | "pull_request"
    | "review_comment"
    | "file_line"
    | "openapi_path"
    | "schema_version"
    | "check_run"
    | "task";
  repo?: string;
  branch?: string;
  commitSha?: string;
  pullRequestId?: string;
  reviewCommentId?: string;
  filePath?: string;
  line?: number;
  openApiPath?: string;
  schemaVersion?: number;
  checkRunId?: string;
  taskId?: string;
}

export interface MessageEnvelope {
  messageId: string;
  taskId: string;
  fromAgent: string;
  toAgent: string;
  messageType: MessageType;
  contextRefs: ContextRef[];
  requestedAction: string;
  expectedArtifact?: string;
  correlationId: string;
  roundTripIndex: number;
  deadline?: string;
  createdAt: string;
}

export interface PullRequestRecord {
  id: string;
  githubNumber: number;
  taskId: string;
  repo: string;
  kind: "contract" | "implementation";
  contractId?: string;
  contractVersion?: number;
  status: "open" | "merged" | "closed";
  mergeableState?: string;
  autoMergeFrozen: boolean;
  reviewApproved: boolean;
  humanApproved: boolean;
  url?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewRecord {
  id: string;
  pullRequestId: string;
  actorType: ReviewActorType;
  actorId: string;
  decision: ReviewDecision;
  comment?: string;
  createdAt: string;
}

export interface CreateTaskInput {
  id: string;
  title: string;
  parentId?: string;
  featureId?: string;
  ownerAgentType: AgentType;
  taskKind: TaskKind;
  dependsOn?: string[];
  contractRefs?: string[];
  repo: string;
  riskLevel: RiskLevel;
  status?: TaskStatus;
  contractVersion?: number;
  contractId?: string;
}
