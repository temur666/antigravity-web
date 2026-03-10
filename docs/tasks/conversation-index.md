# 任务: 自建对话索引 (Conversation Index)

## 背景

LS 虽然有磁盘持久化（.pb 文件），但 `GetAllCascadeTrajectories` 只返回近期/当前账号的对话。
多 LS 实例、多账号场景下，对话列表不完整。需要自建索引层，作为对话列表的 Source of Truth。

## 核心决策

| 项 | 决定 |
|----|------|
| 列表数据源 | 我们的 SQLite（主） + LS API（状态刷新） |
| 内容获取 | LS API 优先，降级到 Markdown 归档 |
| 写入策略 | `INSERT OR IGNORE`，stepCount > 3 才归档 |
| 删除 | 硬删除，同步 LS |
| 归档内容 | Markdown 摘要（ConvertTrajectoryToMarkdown） |
| YOLO | 直接调 index 模块，不走 ConversationStore |

## 实现计划

### Phase 1: 数据层 — `lib/data/conversation-index.js`

纯 SQLite CRUD，零业务逻辑。

**Schema:**

```sql
CREATE TABLE IF NOT EXISTS conversations (
    cascade_id    TEXT PRIMARY KEY,
    trajectory_id TEXT,
    title         TEXT DEFAULT '',
    step_count    INTEGER DEFAULT 0,
    status        TEXT DEFAULT 'IDLE',
    account       TEXT,
    gemini_dir    TEXT,
    source        TEXT,          -- 'manual' | 'yolo' | 'ide' | 'sync'
    workspace     TEXT DEFAULT '',
    created_at    TEXT,
    updated_at    TEXT,
    archived_at   TEXT,
    yolo_task     TEXT,
    yolo_summary  TEXT,
    markdown      TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_account ON conversations(account);
CREATE INDEX IF NOT EXISTS idx_conv_source  ON conversations(source);
```

**API:**

```js
// 创建/初始化
const index = new ConversationIndex(dbPath);

// 写入（INSERT OR IGNORE）
index.insert(cascadeId, { account, geminiDir, source, workspace, createdAt });

// 归档完成的对话
index.finalize(cascadeId, { title, stepCount, trajectoryId, status, updatedAt, markdown });

// 列表查询
index.list({ limit, offset, account, source, search });

// 单条查询
index.get(cascadeId);

// 删除
index.delete(cascadeId);

// 批量 upsert（从 LS 同步时用）
index.upsertMany(conversations);

// 统计
index.stats();  // { total, byAccount: {}, bySource: {} }
```

**文件:** `lib/data/conversation-index.js`
**测试:** `lib/data/__tests__/conversation-index.test.js`

---

### Phase 2: 归档服务 — `lib/core/conversation/archive.js`

协调 LS API + SQLite Index 的业务逻辑。

**职责:**

1. **onCreate** — 对话创建后，INSERT 到索引
2. **onComplete** — 对话完成（IDLE + stepCount > 3），拉取 title & markdown，UPDATE 索引
3. **onDelete** — 对话删除后，DELETE 索引记录
4. **syncFromLS** — 从当前 LS 拉取所有对话，批量 upsert 到索引
   - 发现索引中没有的 → 追加
   - 发现索引中已有的 → 更新 status、stepCount、title

**集成点:**

```
ConversationStore.newChat()
  → 创建成功后调用 archive.onCreate(cascadeId, meta)

ConversationSync (status_changed 事件)
  → 检测到 RUNNING → IDLE 且 stepCount > 3
  → 调用 archive.onComplete(cascadeId)

Controller.init()
  → 初始化时调用 archive.syncFromLS()

health-check.js (smokeTest 中的 DeleteCascadeTrajectory)
  → 冒烟测试的对话不记录（stepCount = 0）
```

**文件:** `lib/core/conversation/archive.js`
**测试:** `lib/core/conversation/__tests__/archive.test.js`

---

### Phase 3: 集成到 ConversationStore + Controller

**state.js 修改:**

```js
// newChat() 末尾添加:
async newChat() {
    // ... 现有逻辑 ...
    const cascadeId = result.data?.cascadeId;
    if (cascadeId) {
        this._archive.onCreate(cascadeId, {
            account: this._currentAccount,
            source: 'manual',
        });
    }
    return cascadeId;
}

// listConversations() 改为以 SQLite 索引为主:
async listConversations() {
    // 1. 从 SQLite 索引读取全量列表
    const indexed = this._archive.index.list({ limit: 500 });

    // 2. 如果 LS 在线，拉取实时 status 刷新
    if (this._lsManager.ls) {
        const live = await this._fetchLiveStatuses();
        this._archive.mergeStatuses(indexed, live);
    }

    return indexed;
}
```

**controller.js 修改:**

```js
constructor() {
    // ... 现有代码 ...
    this._archive = new ConversationArchive(this._lsManager, this._store);
}

async init() {
    const ok = await this._lsManager.init();
    if (ok) {
        await this._archive.syncFromLS();  // 启动时同步
    }
    return ok;
}
```

**sync.js 修改 (status_changed 事件处理):**

```js
// _fetchAndDiff 中检测状态变更:
if (oldStatus === 'RUNNING' && newStatus === 'IDLE' && conv.steps.length > 3) {
    this.emit('conversation_completed', { cascadeId, stepCount: conv.steps.length });
}
```

---

### Phase 4: YOLO 集成

**yolo.js 修改 (约 5 行):**

```js
// 文件头部添加:
const ConversationIndex = require('../lib/data/conversation-index');
const index = new ConversationIndex();

// 创建对话后 (约 L316):
index.insert(cascadeId, {
    account: user.email,
    source: 'yolo',
    yoloTask: docContent.slice(0, 500),
    createdAt: new Date().toISOString(),
});

// YOLO 结束时 (约 L448, break 之前):
index.finalize(cascadeId, {
    title: 'YOLO: ' + (config.task || path.basename(config.docPath || '')),
    stepCount: lastShownIndex,
    yoloSummary: marker?.summary || `${round} 轮完成`,
    updatedAt: new Date().toISOString(),
});
```

---

### Phase 5: 前端 API 适配

**`GET /api/conversations` 响应格式不变，但数据更丰富:**

```json
{
  "total": 52,
  "conversations": [
    {
      "id": "3461218a-...",
      "title": "Conversation API Audit Fixes",
      "stepCount": 50,
      "status": "IDLE",
      "account": "tiemuer2025@gmail.com",
      "source": "yolo",
      "workspace": "/home/tiemuer",
      "createdAt": "2026-03-10T06:47:39Z",
      "updatedAt": "2026-03-10T06:50:25Z",
      "hasArchive": true
    }
  ]
}
```

新增字段: `account`, `source`, `hasArchive`（是否有 Markdown 归档）
前端可用 `account` 做筛选/分组，用 `source` 标记 YOLO 对话。

**`GET /api/conversations/:id` 也不变:**
- 优先 LS API → 实时 steps
- LS 不可用 → 返回 archived markdown

---

## 数据库文件位置

`data/conversations.db` — 在项目根目录下，可被 git ignore。

---

## 改动文件清单

| 文件 | 动作 | 改动量 |
|------|------|--------|
| `lib/data/conversation-index.js` | **新建** | ~150 行 |
| `lib/data/__tests__/conversation-index.test.js` | **新建** | ~120 行 |
| `lib/core/conversation/archive.js` | **新建** | ~180 行 |
| `lib/core/conversation/__tests__/archive.test.js` | **新建** | ~100 行 |
| `lib/core/conversation/state.js` | 修改 | ~20 行（newChat + listConversations） |
| `lib/core/conversation/sync.js` | 修改 | ~5 行（emit conversation_completed） |
| `lib/core/controller.js` | 修改 | ~10 行（初始化 archive + syncFromLS） |
| `scripts/yolo.js` | 修改 | ~15 行（insert + finalize） |
| `main.js` | 修改 | ~5 行（新 REST endpoint /api/conversations/:id） |
| `.gitignore` | 修改 | 1 行（data/*.db） |

**总计:** ~600 行新代码，~55 行修改

---

## 执行顺序

```
Phase 1: conversation-index.js + 测试 (纯数据层，可独立验证)
     ↓
Phase 2: archive.js + 测试 (需要 mock LS API)
     ↓
Phase 3: 集成到 state/sync/controller (最小改动)
     ↓
Phase 4: YOLO 集成 (约 5 行改动)
     ↓
Phase 5: 前端适配 (API 兼容，增量字段)
```

## 约束

- Phase 1-2 是新建文件，不影响现有功能
- Phase 3-4 是最小侵入式修改，保持向后兼容
- 前端 API 响应格式保持兼容（新增字段，不删旧字段）
- 每个 Phase 完成后独立提交

## 完成 Hook

```bash
node /home/tiemuer/antigravity-web/scripts/yolo-done.js "对话索引系统完成 (5 Phases), 新建 4 文件, 修改 5 文件"
```
