# 250227-1040 LS API 完整参数更新

## 修改模块

### 后端 (server-v2.js, lib/ws-protocol.js, lib/controller.js)

1. **Bug Fix: `chatConfigs` → `clientModelConfigs`**
   - `server-v2.js` L56: 字段名错误导致前端拿不到模型列表
   - 同时增加了 `supportsImages`, `supportedMimeTypes`, `defaultModel` 等字段

2. **Bug Fix: `req_unsubscribe` 返回 `res_subscribe`**
   - `server-v2.js` L137: 修正为 `res_unsubscribe`
   - `ws-protocol.js` RES_TYPES 新增 `res_unsubscribe`

3. **默认模型更新: `M18` → `M37`**
   - `ws-protocol.js` DEFAULT_CONFIG.model
   - 跟随 LS 的 `defaultOverrideModelConfig`

4. **`buildSendBody` 支持 mentions/media**
   - 新增第四个参数 `extras = { mentions, media }`
   - @mention: 添加 `{ item: { file: { absoluteUri } } }` 到 items
   - media: 通过文件路径引用（`uri` + `thumbnail`）

5. **`Controller.sendMessage` 透传 extras**

6. **`req_send_message` 支持 mentions/media**

7. **空 catch 改为 console.warn**
   - `GetUserStatus` 失败时不再完全静默

### 前端 (types/, store/, components/)

1. **`ModelInfo` 类型新增**
   - `models: string[]` → `models: ModelInfo[]`
   - 包含 label, model, supportsImages, supportedMimeTypes, quota, tag

2. **`ResUnsubscribe` 类型新增**

3. **`ReqSendMessage` 新增 mentions/media 字段**

4. **`ConfigPanel` 模型选择器**
   - 显示 label + tag 而非 model ID
   - 例: "Gemini 3.1 Pro (High) [New]"

5. **`DEFAULT_CONFIG.model` 更新为 M37**

6. **agenticMode label 改为"对话模式"**
   - Description: "Planning (先规划后执行) / Fast (直接执行)"

### 测试

- `ws-protocol.test.js`: 新增 3 个 mentions/media 测试，更新默认模型断言
- `controller.test.js`: 更新默认模型断言

## 模型映射参考

| 显示名 | Model ID |
|:--|:--|
| Gemini 3.1 Pro (High) | MODEL_PLACEHOLDER_M37 |
| Gemini 3.1 Pro (Low)  | MODEL_PLACEHOLDER_M36 |
| Gemini 3 Flash        | MODEL_PLACEHOLDER_M18 |
| Claude Sonnet 4.6     | MODEL_PLACEHOLDER_M35 |
| Claude Opus 4.6       | MODEL_PLACEHOLDER_M26 |
| GPT-OSS 120B          | MODEL_OPENAI_GPT_OSS_120B_MEDIUM |
