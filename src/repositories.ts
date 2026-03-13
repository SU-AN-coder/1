import type {
  AuditEntry,
  ContractRecord,
  MessageEnvelope,
  PlatformEvent,
  PullRequestRecord,
  ReviewRecord,
  Task,
} from "./domain.js";

export interface TaskRepository {
  save(task: Task): Task;
  getById(id: string): Task | undefined;
  list(): Task[];
  listByContractRef(contractId: string): Task[];
}

export interface ContractRepository {
  save(contract: ContractRecord): ContractRecord;
  getById(id: string): ContractRecord | undefined;
  list(): ContractRecord[];
}

export interface PullRequestRepository {
  save(pullRequest: PullRequestRecord): PullRequestRecord;
  getById(id: string): PullRequestRecord | undefined;
  getByGithubNumber(githubNumber: number): PullRequestRecord | undefined;
  list(): PullRequestRecord[];
  listByTaskId(taskId: string): PullRequestRecord[];
}

export interface ReviewRepository {
  append(review: ReviewRecord): ReviewRecord;
  listByPullRequestId(pullRequestId: string): ReviewRecord[];
}

export interface MessageRepository {
  append(message: MessageEnvelope): MessageEnvelope;
  listByTaskId(taskId: string): MessageEnvelope[];
  listByCorrelationId(correlationId: string): MessageEnvelope[];
}

export interface EventRepository {
  append(event: PlatformEvent): PlatformEvent;
  list(): PlatformEvent[];
  listByTaskId(taskId: string): PlatformEvent[];
}

export interface AuditRepository {
  append(audit: AuditEntry): AuditEntry;
  list(): AuditEntry[];
  listByEntityId(entityId: string): AuditEntry[];
}

export interface WebhookDeliveryRepository {
  has(deliveryId: string): boolean;
  save(deliveryId: string): void;
}

class InMemoryTaskRepository implements TaskRepository {
  private readonly tasks = new Map<string, Task>();

  save(task: Task): Task {
    this.tasks.set(task.id, task);
    return task;
  }

  getById(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  list(): Task[] {
    return [...this.tasks.values()];
  }

  listByContractRef(contractId: string): Task[] {
    return this.list().filter((task) => task.contractRefs.includes(contractId));
  }
}

class InMemoryContractRepository implements ContractRepository {
  private readonly contracts = new Map<string, ContractRecord>();

  save(contract: ContractRecord): ContractRecord {
    this.contracts.set(contract.id, contract);
    return contract;
  }

  getById(id: string): ContractRecord | undefined {
    return this.contracts.get(id);
  }

  list(): ContractRecord[] {
    return [...this.contracts.values()];
  }
}

class InMemoryPullRequestRepository implements PullRequestRepository {
  private readonly pullRequests = new Map<string, PullRequestRecord>();

  save(pullRequest: PullRequestRecord): PullRequestRecord {
    this.pullRequests.set(pullRequest.id, pullRequest);
    return pullRequest;
  }

  getById(id: string): PullRequestRecord | undefined {
    return this.pullRequests.get(id);
  }

  getByGithubNumber(githubNumber: number): PullRequestRecord | undefined {
    return this.list().find((pullRequest) => pullRequest.githubNumber === githubNumber);
  }

  list(): PullRequestRecord[] {
    return [...this.pullRequests.values()];
  }

  listByTaskId(taskId: string): PullRequestRecord[] {
    return this.list().filter((pullRequest) => pullRequest.taskId === taskId);
  }
}

class InMemoryReviewRepository implements ReviewRepository {
  private readonly reviews = new Map<string, ReviewRecord[]>();

  append(review: ReviewRecord): ReviewRecord {
    const list = this.reviews.get(review.pullRequestId) ?? [];
    list.push(review);
    this.reviews.set(review.pullRequestId, list);
    return review;
  }

  listByPullRequestId(pullRequestId: string): ReviewRecord[] {
    return [...(this.reviews.get(pullRequestId) ?? [])];
  }
}

class InMemoryMessageRepository implements MessageRepository {
  private readonly messages = new Map<string, MessageEnvelope[]>();

  append(message: MessageEnvelope): MessageEnvelope {
    const list = this.messages.get(message.taskId) ?? [];
    list.push(message);
    this.messages.set(message.taskId, list);
    return message;
  }

  listByTaskId(taskId: string): MessageEnvelope[] {
    return [...(this.messages.get(taskId) ?? [])];
  }

  listByCorrelationId(correlationId: string): MessageEnvelope[] {
    return this.listAll().filter((message) => message.correlationId === correlationId);
  }

  private listAll(): MessageEnvelope[] {
    return [...this.messages.values()].flat();
  }
}

class InMemoryEventRepository implements EventRepository {
  private readonly events: PlatformEvent[] = [];

  append(event: PlatformEvent): PlatformEvent {
    this.events.push(event);
    return event;
  }

  list(): PlatformEvent[] {
    return [...this.events];
  }

  listByTaskId(taskId: string): PlatformEvent[] {
    return this.events.filter((event) => event.taskId === taskId);
  }
}

class InMemoryAuditRepository implements AuditRepository {
  private readonly audits: AuditEntry[] = [];

  append(audit: AuditEntry): AuditEntry {
    this.audits.push(audit);
    return audit;
  }

  list(): AuditEntry[] {
    return [...this.audits];
  }

  listByEntityId(entityId: string): AuditEntry[] {
    return this.audits.filter((audit) => audit.entityId === entityId);
  }
}

class InMemoryWebhookDeliveryRepository implements WebhookDeliveryRepository {
  private readonly processedDeliveries = new Set<string>();

  has(deliveryId: string): boolean {
    return this.processedDeliveries.has(deliveryId);
  }

  save(deliveryId: string): void {
    this.processedDeliveries.add(deliveryId);
  }
}

export interface PlatformRepositories {
  tasks: TaskRepository;
  contracts: ContractRepository;
  pullRequests: PullRequestRepository;
  reviews: ReviewRepository;
  messages: MessageRepository;
  events: EventRepository;
  audits: AuditRepository;
  webhookDeliveries: WebhookDeliveryRepository;
}

export function createInMemoryRepositories(): PlatformRepositories {
  return {
    tasks: new InMemoryTaskRepository(),
    contracts: new InMemoryContractRepository(),
    pullRequests: new InMemoryPullRequestRepository(),
    reviews: new InMemoryReviewRepository(),
    messages: new InMemoryMessageRepository(),
    events: new InMemoryEventRepository(),
    audits: new InMemoryAuditRepository(),
    webhookDeliveries: new InMemoryWebhookDeliveryRepository(),
  };
}
