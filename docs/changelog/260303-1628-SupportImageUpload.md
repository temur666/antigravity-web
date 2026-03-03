# 支持上传图片

- `server.js` 新增了 multer 依赖，新增 `/api/upload` 接口，接收图片并存放到 `/tmp` 或系统的 `/tmp/antigravity_uploads` 目录。
- 前端 `InputBox.tsx` 增加了图片附件的文件处理功能。
- `InputBox.tsx` 增加附件状态，支持读取文件框文件、检测 Ctrl+V 剪贴板文件、处理拖拽文件获取。
- `index.css` 增加了拖放阴影高亮和图片缩略图及删除按钮等相应样式。
- 上传的 `media` 结构按照 `sendMessage` 所要求的 `{ uri, mimeType }` 附加。
