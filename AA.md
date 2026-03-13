# 多 Agent 协作研发平台 MVP 技术方案 (基于 GitHub Enterprise)

## Summary
建设一套适配 **5-20 人团队** 的私有多 Agent 协作平台，底座复用 **GitHub Enterprise** 的仓库、分支、PR、Review、Check-run 与权限体系；在其上增加一个中心编排层，负责任务拆解、契约门禁、状态流转、消息路由、审计与人工审批。

**MVP 的核心原则（四大铁律）：**
1. **契约先行**：没有已合并的契约，开发 Agent 不得开工。
2. **GitHub 实体优先通信**：优先通过 PR、Review Comment、Check-run、状态流转协作，避免自由聊天。
3. **有限协商**：P2P 协商最多 **3** 个往返，超限直接升级给人类。
4. **变更可回滚**：契约变更和代码冲突都必须能把下游任务安全拉回受控（Blocked）状态。

---

## 1. 协作角色与任务流转

### 角色固定
* **PM Agent**：把人类输入转为标准化 PRD 和高层任务树。
* **Architect Agent**：只产出契约，绝对不写业务代码。
* **Frontend / Backend Agent**：严格按已合并契约开发。
* **Test Agent**：消费 PR 事件，执行自动化测试与契约一致性校验。
* **Review Agent**：做代码结构、兼容性、任务闭环检查。
* **Human Approver (人类)**：处理关键审批、契约最终确认、代码冲突兜底。

### 任务模型
采用 `Epic -> Feature -> Task -> Subtask` 四层模型。最小可执行单元是 Subtask，每个任务至少包含：
* `task_id` | `parent_id` | `owner_agent_type` | `depends_on`
* `contract_refs` | `repo` | `risk_level` | `status`
* `block_reason` | `contract_version`

### 强制状态机
**主状态流：**
`draft` -> `prd_ready` -> `contract_pending` -> `contract_in_review` -> `contract_merged` -> `dev_ready` -> `in_progress` -> `pr_opened` -> `under_review` -> `done` 
*(异常分支：`blocked`, `awaiting_human`)*

**硬门禁：**
1. PM Agent 完成 PRD 后进入 `prd_ready`。
2. Architect Agent 提交契约 PR 后进入 `contract_in_review`。
3. **双签门禁**：契约 PR 必须被 `Review Agent` + `Human Approver` 双签并合并后，任务才进入 `contract_merged`。
4. **开发解锁**：只有 `contract_merged` 的任务，开发 Agent 才能领取、建分支、开 PR。

### 逆向流转与级联阻塞 (应对契约变更风暴)
一旦某个已合并契约再次出现修改 PR（进入 `contract_in_review`）：
1. 编排层立即扫描所有依赖该契约且状态为 `in_progress` / `pr_opened` / `under_review` 的下游任务。
2. 统一强制修改状态：`status = blocked`, `block_reason = contract_updating`，并冻结自动合并流程。
3. 新契约再次 `contract_merged` 后，编排层广播 `contract_amended` 事件。
4. 下游 Agent 收到后第一动作必须是：**同步新版本 -> 执行 git rebase -> 重新本地校验**。完成后方可恢复 `in_progress`。

---

## 2. 分工方式：以契约为边界并行

### 默认拆解策略
1. 先按业务目标拆 Feature。
2. 再按职责拆 Subtask。
3. **共享边界优先**：所有跨角色共享边界先抽成契约任务（OpenAPI YAML、DB Schema、AsyncAPI、核心接口），再拆实现任务。

### 分支策略
* 命名规范：`agent/{agent-name}/{task-id}-{slug}`
* 一个任务默认只允许一个活跃开发 PR。
* 契约 PR 与实现 PR 严格物理分离。
* 实现任务必须绑定明确的 `contract_version`，绝不依赖草稿契约。

---

## 3. 通信方案：GitHub 实体优先，Hub 负责编排

### 间接通信优先 (Stigmergy)
Agent 默认不通过 Message Hub 进行日常探讨，而是通过以下 GitHub 实体协作：
* **PR Description**：传递任务上下文、验收条件、契约引用。
* **Review Comment**：代码问题、修改建议、阻塞说明（Test Agent 和 Review Agent 的主要输出途径）。
* **Check-run / Commit Status**：测试红绿状态、阶段完成信号。

### Message Hub 的严格克制
Hub 拒绝自由聊天窗口模式，只做三件事：
1. 路由结构化协商消息。
2. 维护任务上下文索引。
3. 执行死锁控制、超时控制与全量审计。

---

## 4. Agent 协议、本地上下文组装与防死锁

### 协议风格与上下文引用
采用类似 MCP 的结构化上下文协议。绝不传输整仓代码，只传“指针”和“动作”。
`context_refs` 必须引用具体对象，如：`pull_request_id`, `file_path + line`, `openapi_path`, `check_run_id`。

### 客户端能力基础设施 (核心约束)
本地 Agent 客户端**必须内置 Repo Context Tool**，支持：
* 按 `file_path + line` 抽取最小代码切片。
* 基于 AST 或 LSP 做符号跳转与局部上下文加载。
* 基于 commit/PR diff 聚焦变更面。
* *注：编排层只发指针，本地 Agent 按需加载，杜绝 Token 爆炸。*

### 3 回合熔断机制
针对 P2P 协商（如 `negotiation_request`）：
1. 双方最多允许 **3** 个往返。
2. 第 3 回合结束未达成一致且未产出新契约 PR：当前任务标记为 `blocked`，触发 `human.approval.required`。
3. 人类介入后决策：修改契约 / 驳回协商保持原状 / 拆解新任务。

---

## 5. 平台模块与关键接口

### 核心模块 (MVP 7 件套)
1. **Task Orchestrator**：任务拆解、依赖图、状态机。
2. **Contract Gatekeeper**：契约版本检测、双签拦截、级联影响评估。
3. **Agent Registry**：登记身份、主人、能力、Repo 权限。
4. **Message Hub**：结构化消息路由。
5. **Audit Store**：全生命周期审计记录。
6. **GitHub Adapter**：Webhook 消费与 API 交互。
7. **Conflict Watcher**：PR 冲突监听与熔断。

### Git 冲突处理兜底
编排层监听 `mergeable_state`，一旦变为 `dirty`：
* 任务自动进入 `awaiting_human`，`block_reason = merge_conflict`。
* 暂停自动 review/merge，通知 Human Approver。
* *MVP 不要求原始 Dev Agent 解冲突，避免代码越界破坏。*

### 权限模型 (三层架构)
* **身份**：Human User / Owned Agent / Platform Service。
* **继承规则**：Agent 权限上限**绝对不得超过**其归属成员的主人权限。
* **双门禁**：建分支、提 PR 需同时通过“平台策略校验”与“GitHub Enterprise 权限校验”。

---

## 6. Assumptions (基本假设)
* 第一版仅覆盖单团队、单 GitHub Enterprise 组织内的私有仓库。
* Agent 运行在成员本地，平台不提供统一托管的 Runner，只做调度和编排。
* 契约文件是唯一的“单点事实 (Single Source of Truth)”，实现代码无条件服从契约。
* MVP 的终极目标是 **可治理、可追踪、可收敛**，而非单纯追求 100% 的自动化率。