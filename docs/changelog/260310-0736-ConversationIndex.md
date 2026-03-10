# 对话索引系统实现

## 概述

实现自建对话索引系统，覆盖 5 个 Phase，作为对话列表的 Source of Truth。

## 改动文件

### 新建文件

| 文件 | 用途 |
|------|------|
| `lib/data/conversation-index.js` | SQLite CRUD 数据层（~220 行） |
| `lib/data/__tests__/conversation-index.test.js` | 数据层测试（24 项） |
| `lib/core/conversation/archive.js` | 归档服务层（~200 行） |
| `lib/core/conversation/__tests__/archive.test.js` | 归档服务测试（14 项） |

### 修改文件

| 文件 | 改动 |
|------|------|
| `lib/core/controller.js` | 集成 Archive（初始化、newChat 索引、完成归档、destroy 清理） |
| `lib/core/conversation/sync.js` | `_fetchAndDiff` 中 emit `conversation_completed` 事件 |
| `scripts/yolo.js` | 对话创建后 insert + 结束时 finalize |
| `main.js` | REST API 增强（过滤、`/api/conversations/:id` 降级归档） |
| `.gitignore` | 排除 `data/*.db` 和 `.yolo-done` |

## Schema

```sql
conversations (
  cascade_id PK, trajectory_id, title, step_count,
  status, account, gemini_dir, source, workspace,
  created_at, updated_at, archived_at,
  yolo_task, yolo_summary, markdown
)
```

## 核心链路

```
创建对话 → INSERT OR IGNORE → 对话完成 + stepCount > 3 → 归档 markdown → SQLite 为列表主源
```

## 测试结果

38/38 全部通过。
