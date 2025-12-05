const tilesEl = document.getElementById("ticketTiles");
const refreshBtn = document.getElementById("refreshBtn");
const completedBtn = document.getElementById("completedBtn");
const ticketTitle = document.getElementById("ticketTitle");
const ticketStatusDot = document.getElementById("ticketStatusDot");
const ticketMeta = document.getElementById("ticketMeta");
const originalQuestion = document.getElementById("originalQuestion");
const structuredInput = document.getElementById("structuredInput");
const knowledgeInput = document.getElementById("knowledgeInput");
const answerInput = document.getElementById("answerInput");
const confirmStructureBtn = document.getElementById("confirmStructureBtn");
const confirmKnowledgeBtn = document.getElementById("confirmKnowledgeBtn");
const confirmAnswerBtn = document.getElementById("confirmAnswerBtn");
const fetchKnowledgeBtn = document.getElementById("fetchKnowledgeBtn");
const generateAnswerBtn = document.getElementById("generateAnswerBtn");
const logsBox = document.getElementById("logsBox");
const completedModal = document.getElementById("completedModal");
const closeModalBtn = document.getElementById("closeModalBtn");
const completedTableWrap = document.getElementById("completedTableWrap");
const backToStep1 = document.getElementById("backToStep1");
const backToStep2 = document.getElementById("backToStep2");
const agentFilter = document.getElementById("agentFilter");
const backToList = document.getElementById("backToList");
const stepNodes = Array.from(document.querySelectorAll(".step-node"));
const stepPanels = {
  1: document.getElementById("step-1"),
  2: document.getElementById("step-2"),
  3: document.getElementById("step-3"),
};
const historyList = document.getElementById("historyList");
const agentMsgInput = document.getElementById("agentMsgInput");
const sendAgentMsgBtn = document.getElementById("sendAgentMsgBtn");
const layoutGrid = document.getElementById("layoutGrid");
const chatPanel = document.getElementById("chatPanel");
const toggleChatBtn = document.getElementById("toggleChatBtn");

let currentId = null;
let pollTimer = null;
let currentStepUI = 1;
let readonlyMode = false;
let knowledgeLoading = false;
let answerLoading = false;

function applyReadonly() {
  const disable = readonlyMode;
  [structuredInput, knowledgeInput, answerInput].forEach((el) => {
    el.readOnly = disable;
    el.style.opacity = disable ? 0.8 : 1;
  });
  [
    confirmStructureBtn,
    confirmKnowledgeBtn,
    confirmAnswerBtn,
    fetchKnowledgeBtn,
    generateAnswerBtn,
    backToStep1,
    backToStep2,
  ].forEach((btn) => {
    if (!btn) return;
    btn.style.display = disable ? "none" : "";
  });
}

function formatStatus(ticket) {
  if (!ticket) return { text: "待处理", color: "yellow" };
  if (ticket.status === "done") return { text: "已完成", color: "green" };
  if (ticket.status === "pending_cs") return { text: "待执行", color: "yellow" };
  if (ticket.status === "processing" && ticket.step === "answer_review") return { text: "待确认回答", color: "yellow" };
  if (ticket.status === "processing") return { text: "处理中", color: "yellow" };
  return { text: "待处理", color: "yellow" };
}

function formatStructuredDisplay(text) {
  if (!text) return "";
  const cleaned = text.replace(/行\d+[:：]?\s*/g, "").trim();
  const lines = cleaned
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const typeLine = lines.find((l) => /问题类型/.test(l));
  const descLine = lines.find((l) => /问题描述/.test(l));
  const type = typeLine ? typeLine.replace(/问题类型[:：]?\s*/i, "") : "";
  const desc = descLine
    ? descLine.replace(/问题描述[:：]?\s*/i, "")
    : lines.find((l) => !/问题类型/.test(l)) || lines[0] || cleaned;
  if (type && desc) return `问题类型：${type}；问题描述：${desc}`;
  return desc || cleaned;
}

function pickType(text) {
  if (!text) return "";
  const cleaned = text.replace(/行\d+[:：]?\s*/g, "").trim();
  const typeLine = cleaned
    .split("\n")
    .map((l) => l.trim())
    .find((l) => /问题类型/.test(l));
  if (typeLine) return typeLine.replace(/问题类型[:：]?\s*/i, "");
  return cleaned.slice(0, 40);
}

function renderTiles(tickets) {
  tilesEl.innerHTML = "";
  tickets.forEach((t) => {
    const elapsed = Date.now() - new Date(t.createdAt).getTime();
    const overdue = t.status !== "done" && elapsed > 10 * 60 * 1000;
    const dotColor =
      t.status === "done"
        ? "var(--success)"
        : overdue
        ? "var(--danger)"
        : "var(--warn)";
    const div = document.createElement("div");
    div.className = "ticket-tile" + (currentId === t.id ? " active" : "");
    div.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="dot-small" style="background:${dotColor};"></span>
          <span style="font-weight:700;">${t.id}</span>
        </div>
      </div>
      <div style="margin-top:8px; font-size:14px;">问题类型：${pickType(t.structuredFinal || t.structuredDraft || "") || "待补充"}</div>
      <div class="fade" style="font-size:12px; margin-top:4px;">用户：${t.userId || "访客"}</div>
      <div class="fade" style="font-size:12px; margin-top:6px;">更新：${new Date(t.updatedAt).toLocaleString()}</div>
    `;
    div.onclick = () => loadTicketDetail(t.id);
    tilesEl.appendChild(div);
  });
}

async function loadTickets() {
  let statusParam = agentFilter.value || "pending";
  if (statusParam === "pending_only") statusParam = "pending";
  const resp = await fetch(`/api/agent/tickets?status=${encodeURIComponent(statusParam)}`);
  const data = await resp.json();
  if (resp.ok) renderTiles(data.tickets || []);
}

function renderLogs(ticket) {
  if (!ticket.logs || !ticket.logs.length) {
    logsBox.innerText = "暂无记录";
    return;
  }
  const actionMap = {
    "rewrite": "AI改写",
    "confirm-structure": "结构化确认",
    "knowledge-recall": "知识召回",
    "confirm-knowledge": "知识确认",
    "generate-answer": "回答生成",
    "confirm-answer": "回答确认",
    "cancel": "取消工单",
  };
  logsBox.innerHTML = ticket.logs
    .slice()
    .reverse()
    .map((l) => {
      const actionText = actionMap[l.action] || l.action;
      const actorText = l.actor === "agent" ? "客服" : l.actor === "user" ? "用户" : "系统";
      return `<div><strong>${actorText}</strong> · ${actionText}<br/><span class="fade">${new Date(l.at).toLocaleString()}</span><br/>${l.detail || ""}</div><div class="divider" style="margin:8px 0;"></div>`;
    })
    .join("");
}

function renderHistory(ticket) {
  if (!historyList) return;
  const msgs = ticket.messages || [];
  if (!msgs.length) {
    historyList.innerText = "暂无消息";
    return;
  }
  historyList.innerHTML = msgs
    .map((m) => {
      const isUser = m.role === "user";
      const roleText = isUser
        ? "用户"
        : m.role === "agent"
        ? "客服"
        : m.role === "answer"
        ? "工单解答"
        : "系统";
      const timeText = m.at ? new Date(m.at).toLocaleString() : "";
      const bubbleColor = isUser
        ? "linear-gradient(135deg,#3b82f6,#5aa8ff)"
        : m.role === "answer"
        ? "linear-gradient(135deg,#10b981,#34d399)"
        : "#0f1a2f";
      const textColor = isUser || m.role === "answer" ? "#f8fbff" : "var(--primary)";
      const align = isUser ? "flex-end" : "flex-start";
      return `
        <div style="display:flex; justify-content:${align}; margin-bottom:10px;">
          <div style="max-width:88%; padding:10px 12px; border-radius:12px; background:${bubbleColor}; color:${textColor}; border:1px solid var(--border); box-shadow:0 10px 20px rgba(0,0,0,0.25);">
            <div style="font-weight:700; font-size:12px; opacity:0.85;">${roleText} · ${timeText}</div>
            <div style="white-space:pre-wrap; margin-top:4px;">${m.text || ""}</div>
          </div>
        </div>`;
    })
    .join("");
}

function stepFromTicket(ticket) {
  if (!ticket) return 1;
  if (ticket.status === "done" || ticket.step === "done" || ticket.step === "answer_review") return 3;
  if (ticket.step === "knowledge_review") return 2;
  return 1;
}

function setStep(step) {
  currentStepUI = step;
  stepNodes.forEach((node) => {
    const n = Number(node.dataset.step);
    node.classList.remove("active", "done");
    if (n < step || (readonlyMode && n === 3)) node.classList.add("done");
    if (!readonlyMode && n === step) node.classList.add("active");
    if (readonlyMode && step === 3 && n === 3) node.classList.add("active");
    if (readonlyMode) node.style.pointerEvents = "none";
    else node.style.pointerEvents = "auto";
  });
  Object.entries(stepPanels).forEach(([k, el]) => {
    if (readonlyMode) {
      el.classList.add("active");
    } else if (Number(k) === step) el.classList.add("active");
    else el.classList.remove("active");
  });
}

stepNodes.forEach((node) => {
  node.addEventListener("click", () => {
    if (readonlyMode) return;
    const target = Number(node.dataset.step);
    if (target <= currentStepUI) setStep(target);
  });
});

function fillDetail(ticket) {
  currentId = ticket.id;
  readonlyMode = ticket.status === "done";
  ticketTitle.innerText = `工单 ${ticket.id}`;
  const status = formatStatus(ticket);
  if (ticketStatusDot) {
    ticketStatusDot.style.background =
      status.color === "green"
        ? "var(--success)"
        : status.color === "yellow"
        ? "var(--warn)"
        : "var(--accent)";
    ticketStatusDot.title = status.text;
  }
  ticketMeta.innerText = `创建时间：${new Date(ticket.createdAt).toLocaleString()} · 更新：${new Date(ticket.updatedAt).toLocaleString()} · 用户：${ticket.userId}`;
  originalQuestion.innerText = ticket.originalQuestion || "无";
  structuredInput.value = ticket.structuredFinal || ticket.structuredDraft || "";
  knowledgeInput.value = ticket.knowledgeFinal || ticket.knowledgeDraft || "";
  answerInput.value = ticket.answerFinal || ticket.answerDraft || "";
  renderLogs(ticket);
  renderHistory(ticket);
  const step = stepFromTicket(ticket);
  setStep(step);
  applyReadonly();
}

async function loadTicketDetail(id) {
  const resp = await fetch(`/api/agent/tickets/${id}`);
  const data = await resp.json();
  if (!resp.ok) return alert(data.error || "加载失败");
  fillDetail(data.ticket);
  await loadTickets();
}

async function postAction(path, payload) {
  const resp = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || "操作失败");
  return data.ticket;
}

confirmStructureBtn.onclick = async () => {
  if (!currentId) return;
  try {
    confirmStructureBtn.disabled = true;
  const ticket = await postAction(`/api/agent/tickets/${currentId}/confirm-structure`, {
    structured: structuredInput.value,
  });
  fillDetail(ticket);
  loadTickets();
  autoFetchKnowledge(ticket.id);
  setStep(2);
  } catch (e) {
    alert(e.message);
  } finally {
    confirmStructureBtn.disabled = false;
  }
};

fetchKnowledgeBtn.onclick = async () => {
  if (!currentId) return;
  if (knowledgeLoading) return;
  try {
    knowledgeLoading = true;
    knowledgeInput.value = knowledgeInput.value || "召回中，请稍候...";
    knowledgeInput.readOnly = true;
    fetchKnowledgeBtn.disabled = true;
    fetchKnowledgeBtn.innerText = "召回中...";
    const ticket = await postAction(`/api/agent/tickets/${currentId}/fetch-knowledge`);
    knowledgeInput.readOnly = false;
    knowledgeLoading = false;
    knowledgeInput.value = ticket.knowledgeDraft || "";
    fillDetail(ticket);
  } catch (e) {
    knowledgeLoading = false;
    knowledgeInput.readOnly = false;
    alert(e.message);
  } finally {
    fetchKnowledgeBtn.disabled = false;
    fetchKnowledgeBtn.innerText = "自动召回知识";
  }
};

confirmKnowledgeBtn.onclick = async () => {
  if (!currentId) return;
  try {
    confirmKnowledgeBtn.disabled = true;
    const ticket = await postAction(`/api/agent/tickets/${currentId}/confirm-knowledge`, {
      knowledge: knowledgeInput.value,
    });
    fillDetail(ticket);
    loadTickets();
    autoGenerateAnswer(ticket.id);
    setStep(3);
  } catch (e) {
    alert(e.message);
  } finally {
    confirmKnowledgeBtn.disabled = false;
  }
};

generateAnswerBtn.onclick = async () => {
  if (!currentId) return;
  if (answerLoading) return;
  try {
    answerLoading = true;
    answerInput.value = answerInput.value || "生成中，请稍候...";
    answerInput.readOnly = true;
    generateAnswerBtn.disabled = true;
    generateAnswerBtn.innerText = "生成中...";
    const ticket = await postAction(`/api/agent/tickets/${currentId}/generate-answer`);
    answerInput.readOnly = false;
    answerLoading = false;
    answerInput.value = ticket.answerDraft || "";
    fillDetail(ticket);
  } catch (e) {
    answerLoading = false;
    answerInput.readOnly = false;
    alert(e.message);
  } finally {
    generateAnswerBtn.disabled = false;
    generateAnswerBtn.innerText = "生成回答";
  }
};

confirmAnswerBtn.onclick = async () => {
  if (!currentId) return;
  try {
    confirmAnswerBtn.disabled = true;
    const ticket = await postAction(`/api/agent/tickets/${currentId}/confirm-answer`, {
      answer: answerInput.value,
    });
    fillDetail(ticket);
    await loadTickets();
    alert("已完成并推送给客户");
  } catch (e) {
    alert(e.message);
  } finally {
    confirmAnswerBtn.disabled = false;
  }
};

backToStep1.onclick = () => setStep(1);
backToStep2.onclick = () => setStep(2);

refreshBtn.onclick = loadTickets;
agentFilter.addEventListener("change", loadTickets);
if (backToList) {
  backToList.onclick = () => {
    currentId = null;
    readonlyMode = false;
    ticketTitle.innerText = "请选择一个工单";
    if (ticketStatusDot) {
      ticketStatusDot.style.background = "var(--accent)";
      ticketStatusDot.title = "";
    }
    ticketMeta.innerText = "";
    originalQuestion.innerText = "";
    structuredInput.value = "";
    knowledgeInput.value = "";
    answerInput.value = "";
    logsBox.innerText = "暂无记录";
    stepNodes.forEach((node) => node.classList.remove("active", "done"));
    setStep(1);
    applyReadonly();
  };
}

if (sendAgentMsgBtn) {
  sendAgentMsgBtn.onclick = async () => {
    if (!currentId) return;
    const text = (agentMsgInput.value || "").trim();
    if (!text) return;
    sendAgentMsgBtn.disabled = true;
    sendAgentMsgBtn.innerText = "发送中...";
    try {
      const ticket = await postAction(`/api/agent/tickets/${currentId}/message`, { text });
      agentMsgInput.value = "";
      fillDetail(ticket);
      loadTickets();
    } catch (e) {
      alert(e.message);
    } finally {
      sendAgentMsgBtn.disabled = false;
      sendAgentMsgBtn.innerText = "发送";
    }
  };
}

if (toggleChatBtn) {
  toggleChatBtn.onclick = () => {
    const hide = layoutGrid.classList.toggle("hide-chat");
    if (hide) {
      layoutGrid.style.gridTemplateColumns = "260px 1fr";
      if (chatPanel) chatPanel.style.display = "none";
    } else {
      layoutGrid.style.gridTemplateColumns = "260px 1fr 340px";
      if (chatPanel) chatPanel.style.display = "flex";
    }
    if (toggleChatBtn) toggleChatBtn.innerText = hide ? "显示对话" : "隐藏对话";
  };
}
async function autoFetchKnowledge(id) {
  if (knowledgeLoading || !id) return;
  try {
    knowledgeLoading = true;
    knowledgeInput.value = knowledgeInput.value || "召回中，请稍候...";
    knowledgeInput.readOnly = true;
    const ticket = await postAction(`/api/agent/tickets/${id}/fetch-knowledge`);
    knowledgeInput.readOnly = false;
    knowledgeLoading = false;
    knowledgeInput.value = ticket.knowledgeDraft || "";
    fillDetail(ticket);
  } catch (e) {
    knowledgeLoading = false;
    knowledgeInput.readOnly = false;
  }
}

async function autoGenerateAnswer(id) {
  if (answerLoading || !id) return;
  try {
    answerLoading = true;
    answerInput.value = answerInput.value || "生成中，请稍候...";
    answerInput.readOnly = true;
    const ticket = await postAction(`/api/agent/tickets/${id}/generate-answer`);
    answerInput.readOnly = false;
    answerLoading = false;
    answerInput.value = ticket.answerDraft || "";
    fillDetail(ticket);
  } catch (e) {
    answerLoading = false;
    answerInput.readOnly = false;
  }
}

async function loadCompleted() {
  const resp = await fetch("/api/agent/tickets/completed");
  const data = await resp.json();
  if (!resp.ok) return;
  const tickets = data.tickets || [];
  if (!tickets.length) {
    completedTableWrap.innerHTML = "暂无已完成工单";
    return;
  }
  const rows = tickets
    .map(
      (t) => `
      <tr>
        <td>${t.id}</td>
        <td>${t.structuredFinal || t.structuredDraft || ""}</td>
        <td>${t.answerFinal || ""}</td>
        <td>${new Date(t.updatedAt).toLocaleString()}</td>
      </tr>`
    )
    .join("");
  completedTableWrap.innerHTML = `
    <table class="table">
      <thead><tr><th>工单</th><th>问题</th><th>回复</th><th>完成时间</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

completedBtn.onclick = () => {
  completedModal.classList.add("show");
  loadCompleted();
};
closeModalBtn.onclick = () => completedModal.classList.remove("show");
completedModal.addEventListener("click", (e) => {
  if (e.target === completedModal) completedModal.classList.remove("show");
});

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(loadTickets, 6000);
}

loadTickets();
startPolling();
