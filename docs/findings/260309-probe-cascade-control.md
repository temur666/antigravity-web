---
title: Cascade 对话控制 API E2E 验证
date: 2026-03-09
target: daemon LS v1.19.6 (port=42100)
---

# Cascade 对话控制 API E2E 验证结果

## 汇总

| # | API | Variant | Status | Notes |
|---|-----|---------|--------|-------|
| 1 | `SmartFocusConversation` | default | FAIL |  |
| 2 | `UpdateConversationAnnotations` | default | FAIL |  |
| 3 | `HandleCascadeUserInteraction` | dummy_reject | FAIL | Send dummy interaction |
| 4 | `AcknowledgeCascadeCodeEdit` | dummy_reject | FAIL |  |
| 5 | `AcknowledgeCodeActionStep` | dummy_accept | OK |  |
| 6 | `RevertToCascadeStep` | default | FAIL |  |
| 7 | `ResolveOutstandingSteps` | default | OK |  |
| 8 | `CancelCascadeSteps` | step_0 | OK |  |
| 9 | `CancelCascadeInvocation` | default | OK |  |
| 10 | `SendAllQueuedMessages` | default | OK |  |
| 11 | `DeleteQueuedUserInputStep` | default | FAIL |  |

## 详细记录

### SmartFocusConversation

#### default

**请求:**
```json
{
  "cascadeId": "aadb1a04-f045-4dfb-8508-e48901730d82"
}
```

**响应 (status=500):**
```json
{
  "code": "unknown",
  "message": "Failed to smart focus conversation: extension server client is disconnected"
}
```

### UpdateConversationAnnotations

#### default

**请求:**
```json
{
  "cascadeId": "aadb1a04-f045-4dfb-8508-e48901730d82",
  "annotations": {
    "summary": "..."
  },
  "mergeAnnotations": true
}
```

**响应 (status=500):**
```json
{
  "code": "unknown",
  "message": "remove /home/tiemuer/.gemini/antigravity/annotations/aadb1a04-f045-4dfb-8508-e48901730d82.pbtxt: no such file or directory"
}
```

### HandleCascadeUserInteraction

#### dummy_reject

**请求:**
```json
{}
```

**响应 (status=500):**
```json
{
  "code": "unknown",
  "message": "input not registered for step 0"
}
```

### AcknowledgeCascadeCodeEdit

#### dummy_reject

**请求:**
```json
{
  "cascadeId": "aadb1a04-f045-4dfb-8508-e48901730d82",
  "accept": false
}
```

**响应 (status=500):**
```json
{
  "code": "unknown",
  "message": "no unacknowledged steps for file file:///home/tiemuer/antigravity-web/package.json"
}
```

### AcknowledgeCodeActionStep

#### dummy_accept

**请求:**
```json
{
  "cascadeId": "aadb1a04-f045-4dfb-8508-e48901730d82",
  "accept": true
}
```

**响应 (status=200):**
```json
{}
```

### RevertToCascadeStep

#### default

**请求:**
```json
{
  "cascadeId": "aadb1a04-f045-4dfb-8508-e48901730d82",
  "stepIndex": 0
}
```

**响应 (status=500):**
```json
{
  "code": "unknown",
  "message": "neither PlanModel nor RequestedModel specified. You must specify a valid model."
}
```

### ResolveOutstandingSteps

#### default

**请求:**
```json
{
  "cascadeId": "aadb1a04-f045-4dfb-8508-e48901730d82"
}
```

**响应 (status=200):**
```json
{}
```

### CancelCascadeSteps

#### step_0

**请求:**
```json
{
  "cascadeId": "aadb1a04-f045-4dfb-8508-e48901730d82",
  "stepIndices": [
    0
  ]
}
```

**响应 (status=200):**
```json
{}
```

### CancelCascadeInvocation

#### default

**请求:**
```json
{
  "cascadeId": "aadb1a04-f045-4dfb-8508-e48901730d82"
}
```

**响应 (status=200):**
```json
{}
```

### SendAllQueuedMessages

#### default

**请求:**
```json
{
  "cascadeId": "aadb1a04-f045-4dfb-8508-e48901730d82"
}
```

**响应 (status=200):**
```json
{}
```

### DeleteQueuedUserInputStep

#### default

**请求:**
```json
{
  "cascadeId": "aadb1a04-f045-4dfb-8508-e48901730d82",
  "stepIndex": 0
}
```

**响应 (status=500):**
```json
{
  "code": "unknown",
  "message": "failed to delete queued user input step: Index 0 is out of bounds (len=0) of the queued user input steps. This is unexpected - the update function may not be properly updating the trajectory"
}
```
