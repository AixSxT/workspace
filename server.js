const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data", "tickets.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const VOLC_API_KEY =
  process.env.API_KEY ||
  process.env.VOLC_API_KEY ||
  "18e37744-5a95-4f3e-9892-3aed71e45841";
const VOLC_BASE_URL =
  process.env.BASE_URL || process.env.VOLC_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3";
const MODEL_NAME =
  process.env.MODEL_NAME || process.env.VOLC_MODEL_NAME || "doubao-seed-1-6-250615";
const COZE_TOKEN =
  process.env.COZE_TOKEN ||
  "sat_kiWBS3pwQwV90JaXOslihMbimBhHpUlGUllS3yuAnZNiUe1BEXSjz3OFPSrxz2l9";
const COZE_WORKFLOW_ID = process.env.COZE_WORKFLOW_ID || "7577424146512134144";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

function sendJSON(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    ...headers,
  });
  res.end(text);
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString("utf8");
      if (body.length > 1e6) {
        reject(new Error("Payload too large"));
        req.connection.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

async function readTickets() {
  try {
    const raw = await fs.promises.readFile(DATA_FILE, "utf8");
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

async function writeTickets(tickets) {
  await fs.promises.writeFile(DATA_FILE, JSON.stringify(tickets, null, 2));
}

function inferType(text) {
  const lower = (text || "").toLowerCase();
  if (lower.includes("支付") || lower.includes("付款")) return "支付问题";
  if (lower.includes("登录") || lower.includes("注册")) return "账号登录";
  if (lower.includes("直播")) return "直播/视频";
  if (lower.includes("app") || lower.includes("应用")) return "app应用";
  if (lower.includes("退款") || lower.includes("退货")) return "售后服务";
  return "通用咨询";
}

function pickLLMText(resp) {
  const choice = resp.choices && resp.choices[0];
  if (!choice) return "";
  const msg = choice.message || {};
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content) && msg.content[0]) {
    return msg.content
      .map((c) => (typeof c === "string" ? c : c.text || ""))
      .join("");
  }
  if (choice.text) return choice.text;
  return "";
}

async function callLLM(prompt) {
  const urlStr = `${VOLC_BASE_URL.replace(/\/$/, "")}/chat/completions`;
  const body = {
    model: MODEL_NAME,
    messages: [
      { role: "system", content: "你是客服智能助手，请用简洁中文输出。" },
      { role: "user", content: prompt },
    ],
    stream: false,
  };
  const resp = await fetch(urlStr, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${VOLC_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`LLM 调用失败：${resp.status} ${text}`);
  }
  const data = await resp.json();
  const out = pickLLMText(data);
  if (!out) throw new Error("LLM 返回空内容");
  return out.trim();
}

async function rewriteQuestion(text) {
  const clean = (text || "").trim();
  const type = inferType(clean);
  const prompt = `请将用户问题改写为结构化的两行文本，不要添加行号、不要输出“行1/行2”等前缀，只输出：
问题类型：<类型>
问题描述：<简洁描述>
用户原话：${clean}
类型可参考：${type}`;
  try {
    const res = await callLLM(prompt);
    // 后处理，移除可能出现的行号、空行
    const cleaned = res
      .replace(/行\s*\d+[:：]?\s*/gi, "")
      .replace(/^\s*[\r\n]+/g, "")
      .trim();
    return cleaned;
  } catch (e) {
    console.error("rewriteQuestion error", e);
    return `问题类型：${type}\n问题描述：${clean || "（未提供描述）"}`;
  }
}

async function fetchKnowledge(structured) {
  const payload = {
    workflow_id: COZE_WORKFLOW_ID,
    parameters: { input: structured || "用户问题" },
  };
  const resp = await fetch("https://api.coze.cn/v1/workflow/stream_run", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${COZE_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`知识召回失败：${resp.status} ${text}`);
  }
  const text = await resp.text();
  const lines = text.split("\n").filter((l) => l.startsWith("data:"));
  let content = "";
  for (const l of lines) {
    try {
      const obj = JSON.parse(l.replace(/^data:\s*/, ""));
      if (obj.content) content = obj.content;
    } catch (e) {
      continue;
    }
  }
  if (!content) throw new Error("未获得知识内容");
  let parsed = content;
  try {
    const inner = JSON.parse(content);
    if (inner.output) parsed = inner.output;
  } catch (e) {
    // keep original
  }
  return String(parsed).trim();
}

async function generateAnswer(structured, knowledge) {
  const prompt = `请基于已确认的结构化问题与知识，为客户生成简洁、同理心的回答。\n结构化问题：\n${structured}\n知识：\n${knowledge}\n输出要求：中文，开头可用“关于您反映的…”，不超过180字，给出清晰操作建议或结论。`;
  try {
    return await callLLM(prompt);
  } catch (e) {
    console.error("generateAnswer error", e);
    return "抱歉，当前生成回答失败，请稍后重试。";
  }
}

function pushLog(ticket, actor, action, detail) {
  ticket.logs = ticket.logs || [];
  ticket.logs.push({
    at: new Date().toISOString(),
    actor,
    action,
    detail,
  });
}

function serveStatic(req, res, pathname) {
  let filePath = path.join(PUBLIC_DIR, pathname);
  if (pathname === "/" || pathname === "") {
    filePath = path.join(PUBLIC_DIR, "customer.html");
  }
  if (pathname === "/agent" || pathname === "/agent/") {
    filePath = path.join(PUBLIC_DIR, "agent.html");
  }
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    fs.createReadStream(filePath).pipe(res);
  });
}

function generateId() {
  const now = Date.now();
  const rand = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `T${now}${rand}`;
}

async function handleApi(req, res) {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || "";
  const segments = pathname.split("/").filter(Boolean);
  if (req.method === "OPTIONS") {
    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  // health
  if (pathname === "/api/ping" && req.method === "GET") {
    return sendJSON(res, 200, { ok: true, time: new Date().toISOString() });
  }

  // client: create ticket
  if (pathname === "/api/tickets" && req.method === "POST") {
    const body = await parseBody(req).catch((err) =>
      sendJSON(res, 400, { error: err.message })
    );
    if (!body) return;
    const userId = body.userId || "guest";
    const message = (body.message || "").trim();
    if (!message) return sendJSON(res, 400, { error: "message is required" });
    const structured = await rewriteQuestion(message);
    const now = new Date().toISOString();
    const ticket = {
      id: generateId(),
      userId,
      status: "collecting",
      step: "collecting",
      createdAt: now,
      updatedAt: now,
      originalQuestion: message,
      structuredDraft: structured,
      structuredFinal: null,
      knowledgeDraft: null,
      knowledgeFinal: null,
      answerDraft: null,
      answerFinal: null,
      messages: [{ role: "user", text: message, at: now }],
      logs: [],
      newReply: false,
    };
    pushLog(ticket, "system", "rewrite", structured);
    const tickets = await readTickets();
    tickets.push(ticket);
    await writeTickets(tickets);
    return sendJSON(res, 200, { ticket });
  }

  // client: confirm structured and submit
  if (segments.length === 4 && segments[0] === "api" && segments[1] === "tickets" && segments[3] === "confirm" && req.method === "POST") {
    const ticketId = segments[2];
    const body = await parseBody(req).catch((err) =>
      sendJSON(res, 400, { error: err.message })
    );
    if (!body) return;
    const userId = body.userId || "guest";
    const extraInfo = (body.extraInfo || "").trim();
    const tickets = await readTickets();
    const ticket = tickets.find((t) => t.id === ticketId && t.userId === userId);
    if (!ticket) return sendJSON(res, 404, { error: "ticket not found" });
    if (extraInfo) {
      ticket.originalQuestion = `${ticket.originalQuestion}\n补充：${extraInfo}`;
    ticket.messages.push({
      role: "user",
      text: extraInfo,
      at: new Date().toISOString(),
    });
  }
    const structured = await rewriteQuestion(ticket.originalQuestion);
    ticket.structuredFinal = structured;
    ticket.structuredDraft = structured;
    ticket.status = "pending_cs";
    ticket.step = "structure_review";
    ticket.updatedAt = new Date().toISOString();
    pushLog(ticket, "user", "confirm-structure", structured);
    await writeTickets(tickets);
    return sendJSON(res, 200, {
      ticket,
      message: "工单已提交客服处理",
    });
  }

  // client: list tickets by user
  if (pathname === "/api/tickets" && req.method === "GET") {
    const userId = parsed.query.userId || "guest";
    const tickets = await readTickets();
    const list = tickets
      .filter((t) => t.userId === userId && t.status !== "canceled")
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return sendJSON(res, 200, { tickets: list });
  }

  // client: get ticket detail
  if (segments.length === 3 && segments[0] === "api" && segments[1] === "tickets" && req.method === "GET") {
    const ticketId = segments[2];
    const tickets = await readTickets();
    const ticket = tickets.find((t) => t.id === ticketId);
    if (!ticket) return sendJSON(res, 404, { error: "ticket not found" });
    return sendJSON(res, 200, { ticket });
  }

  // client: acknowledge reply
  if (segments.length === 4 && segments[0] === "api" && segments[1] === "tickets" && segments[3] === "ack" && req.method === "POST") {
    const ticketId = segments[2];
    const body = await parseBody(req).catch((err) =>
      sendJSON(res, 400, { error: err.message })
    );
    if (!body) return;
    const userId = body.userId || "guest";
    const tickets = await readTickets();
    const ticket = tickets.find((t) => t.id === ticketId && t.userId === userId);
    if (!ticket) return sendJSON(res, 404, { error: "ticket not found" });
    ticket.newReply = false;
    ticket.updatedAt = new Date().toISOString();
    await writeTickets(tickets);
    return sendJSON(res, 200, { ok: true });
  }

  // client: cancel ticket (e.g., skip confirmation)
  if (segments.length === 4 && segments[0] === "api" && segments[1] === "tickets" && segments[3] === "cancel" && req.method === "POST") {
    const ticketId = segments[2];
    const body = await parseBody(req).catch((err) =>
      sendJSON(res, 400, { error: err.message })
    );
    if (!body) return;
    const userId = body.userId || "guest";
    let tickets = await readTickets();
    const idx = tickets.findIndex((t) => t.id === ticketId);
    if (idx === -1) return sendJSON(res, 404, { error: "ticket not found" });
    const ticket = tickets[idx];
    if (ticket.userId !== userId) return sendJSON(res, 403, { error: "forbidden" });
    pushLog(ticket, "user", "cancel", "用户取消工单");
    tickets.splice(idx, 1);
    await writeTickets(tickets);
    return sendJSON(res, 200, { ok: true });
  }

  // agent: list active
  if (pathname === "/api/agent/tickets" && req.method === "GET") {
    const tickets = await readTickets();
    const statusFilter = parsed.query.status || "pending"; // pending | done | all
    let list = tickets;
    // 不推送未确认的 collecting
    list = list.filter((t) => t.status !== "collecting" && t.status !== "canceled");
    if (statusFilter === "pending") {
      list = list.filter((t) => t.status !== "done");
    } else if (statusFilter === "done") {
      list = list.filter((t) => t.status === "done");
    }
    list = list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return sendJSON(res, 200, { tickets: list });
  }

  // agent: list completed
  if (pathname === "/api/agent/tickets/completed" && req.method === "GET") {
    const tickets = await readTickets();
    const done = tickets
      .filter((t) => t.status === "done")
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return sendJSON(res, 200, { tickets: done });
  }

  // agent: get ticket detail
  if (segments.length === 4 && segments[0] === "api" && segments[1] === "agent" && segments[2] === "tickets" && req.method === "GET") {
    const ticketId = segments[3];
    const tickets = await readTickets();
    const ticket = tickets.find((t) => t.id === ticketId);
    if (!ticket) return sendJSON(res, 404, { error: "ticket not found" });
    return sendJSON(res, 200, { ticket });
  }

  // agent: confirm structure
  if (segments.length === 5 && segments[0] === "api" && segments[1] === "agent" && segments[2] === "tickets" && segments[4] === "confirm-structure" && req.method === "POST") {
    const ticketId = segments[3];
    const body = await parseBody(req).catch((err) =>
      sendJSON(res, 400, { error: err.message })
    );
    if (!body) return;
    const structured = (body.structured || "").trim();
    if (!structured) return sendJSON(res, 400, { error: "structured is required" });
    const tickets = await readTickets();
    const ticket = tickets.find((t) => t.id === ticketId);
    if (!ticket) return sendJSON(res, 404, { error: "ticket not found" });
    ticket.structuredFinal = structured;
    ticket.status = "processing";
    ticket.step = "knowledge_review";
    ticket.updatedAt = new Date().toISOString();
    pushLog(ticket, "agent", "confirm-structure", structured);
    await writeTickets(tickets);
    return sendJSON(res, 200, { ticket });
  }

  // agent: fetch knowledge (mock)
  if (segments.length === 5 && segments[0] === "api" && segments[1] === "agent" && segments[2] === "tickets" && segments[4] === "fetch-knowledge" && req.method === "POST") {
    const ticketId = segments[3];
    const tickets = await readTickets();
    const ticket = tickets.find((t) => t.id === ticketId);
    if (!ticket) return sendJSON(res, 404, { error: "ticket not found" });
    const knowledge = await fetchKnowledge(ticket.structuredFinal || ticket.structuredDraft).catch((e) => {
      console.error("fetchKnowledge", e);
      return `知识召回失败：${e.message}`;
    });
    ticket.knowledgeDraft = knowledge;
    ticket.step = "knowledge_review";
    ticket.updatedAt = new Date().toISOString();
    pushLog(ticket, "system", "knowledge-recall", knowledge);
    await writeTickets(tickets);
    return sendJSON(res, 200, { ticket });
  }

  // agent: confirm knowledge
  if (segments.length === 5 && segments[0] === "api" && segments[1] === "agent" && segments[2] === "tickets" && segments[4] === "confirm-knowledge" && req.method === "POST") {
    const ticketId = segments[3];
    const body = await parseBody(req).catch((err) =>
      sendJSON(res, 400, { error: err.message })
    );
    if (!body) return;
    const knowledge = (body.knowledge || "").trim();
    if (!knowledge) return sendJSON(res, 400, { error: "knowledge is required" });
    const tickets = await readTickets();
    const ticket = tickets.find((t) => t.id === ticketId);
    if (!ticket) return sendJSON(res, 404, { error: "ticket not found" });
    ticket.knowledgeFinal = knowledge;
    ticket.step = "answer_review";
    ticket.updatedAt = new Date().toISOString();
    pushLog(ticket, "agent", "confirm-knowledge", knowledge);
    await writeTickets(tickets);
    return sendJSON(res, 200, { ticket });
  }

  // agent: generate answer (mock)
  if (segments.length === 5 && segments[0] === "api" && segments[1] === "agent" && segments[2] === "tickets" && segments[4] === "generate-answer" && req.method === "POST") {
    const ticketId = segments[3];
    const tickets = await readTickets();
    const ticket = tickets.find((t) => t.id === ticketId);
    if (!ticket) return sendJSON(res, 404, { error: "ticket not found" });
    const answer = await generateAnswer(ticket.structuredFinal || ticket.structuredDraft, ticket.knowledgeFinal || ticket.knowledgeDraft);
    ticket.answerDraft = answer;
    ticket.step = "answer_review";
    ticket.updatedAt = new Date().toISOString();
    pushLog(ticket, "system", "generate-answer", answer);
    await writeTickets(tickets);
    return sendJSON(res, 200, { ticket });
  }

  // agent: confirm answer
  if (segments.length === 5 && segments[0] === "api" && segments[1] === "agent" && segments[2] === "tickets" && segments[4] === "confirm-answer" && req.method === "POST") {
    const ticketId = segments[3];
    const body = await parseBody(req).catch((err) =>
      sendJSON(res, 400, { error: err.message })
    );
    if (!body) return;
    const answer = (body.answer || "").trim();
    if (!answer) return sendJSON(res, 400, { error: "answer is required" });
    const tickets = await readTickets();
    const ticket = tickets.find((t) => t.id === ticketId);
    if (!ticket) return sendJSON(res, 404, { error: "ticket not found" });
    ticket.answerFinal = answer;
    ticket.status = "done";
    ticket.step = "done";
    ticket.newReply = true;
    ticket.updatedAt = new Date().toISOString();
    pushLog(ticket, "agent", "confirm-answer", answer);
    await writeTickets(tickets);
    return sendJSON(res, 200, { ticket });
  }

  // export csv
  if (pathname === "/api/agent/export" && req.method === "GET") {
    const tickets = await readTickets();
    const header = [
      "工单编号",
      "用户",
      "状态",
      "创建时间",
      "更新时间",
      "问题结构化",
      "知识内容",
      "最终回答",
      "操作记录",
    ];
    const rows = tickets.map((t) => {
      const logText = (t.logs || [])
        .map((l) => `${l.at}|${l.actor}|${l.action}|${(l.detail || "").replace(/\n/g, " ")}`)
        .join(" || ");
      const escape = (val) => {
        if (val == null) return "";
        const str = String(val).replace(/"/g, '""');
        return `"${str}"`;
      };
      const fmt = (time) =>
        time ? new Date(time).toLocaleString("zh-CN", { hour12: false }) : "";
      return [
        escape(t.id),
        escape(t.userId),
        escape(t.status),
        escape(fmt(t.createdAt)),
        escape(fmt(t.updatedAt)),
        escape(t.structuredFinal || t.structuredDraft || ""),
        escape(t.knowledgeFinal || t.knowledgeDraft || ""),
        escape(t.answerFinal || t.answerDraft || ""),
        escape(logText),
      ].join(",");
    });
    const csv = [header.join(","), ...rows].join("\n");
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="tickets.csv"',
      "Access-Control-Allow-Origin": "*",
    });
    return res.end(csv);
  }

  sendJSON(res, 404, { error: "API not found" });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || "/";
  if (pathname.startsWith("/api")) {
    try {
      await handleApi(req, res);
    } catch (e) {
      console.error(e);
      sendJSON(res, 500, { error: "internal error" });
    }
    return;
  }
  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
