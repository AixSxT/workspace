# 人康工具群答疑智能体（本地版）

## 运行
1. 确保已安装 Node.js（18+）。  
2. 在项目根目录执行：
   ```bash
   node server.js
   ```
3. 浏览器访问：  
   - 客户端提问页：`http://localhost:3000/`  
   - 客服中台：`http://localhost:3000/agent`

## 功能概览
- 客户端：聊天式提问 → AI 结构化改写 → 二次确认 → 创建工单，查看进度与历史（完成后有红点提醒）。
- 客服中台：左侧待办工单列表，右侧流程化步骤（确认改写 → 知识召回与确认 → 生成并确认回答），完成后推送给客户。
- 导出：已完成工单可在中台弹窗查看，支持 CSV/Excel 下载（/api/agent/export）。

## 配置说明
已接入真实 API 调用：
- 问题改写、回答生成：火山方舟 Doubao 模型。  
- 知识召回：Coze workflow（stream_run）。

环境变量（已设置默认值为你提供的 key，可在部署时覆盖）：  
- `API_KEY` / `VOLC_API_KEY`：Doubao API Key  
- `BASE_URL` / `VOLC_BASE_URL`：默认 `https://ark.cn-beijing.volces.com/api/v3`  
- `MODEL_NAME` / `VOLC_MODEL_NAME`：默认 `doubao-seed-1-6-250615`  
- `COZE_TOKEN`：Coze workflow Token（默认使用你最新提供的 sat_* token）  
- `COZE_WORKFLOW_ID`：Workflow ID（默认 `7577424146512134144`）

## 结构
- `server.js`：简单 HTTP 服务 + API 路由 + 静态文件托管。
- `public/`：前端页面与样式（客户/客服分离）。
- `data/tickets.json`：工单持久化文件。
