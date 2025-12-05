const API_BASE = "";
let clientId = localStorage.getItem("clientId");
if (!clientId) {
  clientId = "u-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
  localStorage.setItem("clientId", clientId);
}

let activeTicket = null;
let pollTimer = null;
let dotTimer = null;

const messagesEl = document.getElementById("messages");
const statusTag = document.getElementById("statusTag");
const summaryEl = document.getElementById("ticketSummary");
const ticketListEl = document.getElementById("ticketList");
const sendBtn = document.getElementById("sendBtn");
const userInput = document.getElementById("userInput");
const myTicketsBtn = document.getElementById("myTicketsBtn");
const drawerPanel = document.getElementById("drawerPanel");
const myTicketsDot = document.getElementById("myTicketsDot");
const statusFilter = document.getElementById("statusFilter");

function clearMessages() {
  messagesEl.innerHTML = "";
}

function appendBubble(text, role = "ai") {
  const div = document.createElement("div");
  div.className = `bubble ${role === "me" ? "me" : "ai"}`;
  div.innerText = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendCard(cardEl) {
  cardEl.style.marginBottom = "12px";
  messagesEl.appendChild(cardEl);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function statusText(ticket) {
  return statusMeta(ticket).text;
}

function statusMeta(ticket) {
  if (!ticket) return { text: "待提问", color: "blue" };
  if (ticket.status === "collecting") return { text: "待确认问题", color: "blue" };
  if (ticket.status === "pending_cs" || ticket.status === "processing")
    return { text: "待客服处理", color: "yellow" };
  if (ticket.status === "done") return { text: "已完成", color: "green" };
  return { text: "处理中", color: "yellow" };
}

function setStatus(ticket) {
  const meta = statusMeta(ticket);
  statusTag.textContent = meta.text;
  statusTag.classList.remove("blue", "yellow", "green");
  if (meta.color) statusTag.classList.add(meta.color);
}

function renderConfirmCard(structured, ticketId) {
  const cleaned = (structured || "").replace(/行\d+[:：]?\s*/g, "").trim();
  const lines = cleaned
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const descLine =
    lines.find((l) => /问题描述/.test(l)) ||
    lines.find((l) => !/问题类型/.test(l)) ||
    lines[0] ||
    "";
  const desc =
    descLine
      .replace(/问题描述[:：]?\s*/i, "")
      .replace(/问题类型[:：]?\s*/i, "")
      .trim() || cleaned || "（待确认）";
  const summaryText = desc;
  const card = document.createElement("div");
  card.className = "system-card";
  const title = document.createElement("div");
  title.style.fontWeight = "700";
  title.innerText = `您好，对您的问题我总结了一下，您是想问“${summaryText}”吗？若确认无误我将为您继续处理，如有补充请填写后再确认。`;
  const content = document.createElement("div");
  content.className = "pill";
  content.style.margin = "10px 0";
  content.style.whiteSpace = "pre-wrap";
  content.innerText = summaryText;
  const textarea = document.createElement("textarea");
  textarea.placeholder = "补充其他关键信息（可选）";
  textarea.style.marginTop = "8px";
  const btnRow = document.createElement("div");
  btnRow.style.display = "flex";
  btnRow.style.gap = "10px";
  btnRow.style.marginTop = "10px";
  const confirmBtn = document.createElement("button");
  confirmBtn.className = "btn";
  confirmBtn.innerText = "确认提交客服";
  const skipBtn = document.createElement("button");
  skipBtn.className = "btn ghost";
  skipBtn.innerText = "稍后再说";
  btnRow.appendChild(confirmBtn);
  btnRow.appendChild(skipBtn);
  card.appendChild(title);
  card.appendChild(content);
  card.appendChild(textarea);
  card.appendChild(btnRow);

  confirmBtn.onclick = async () => {
    confirmBtn.disabled = true;
    confirmBtn.innerText = "提交中...";
    try {
      const resp = await fetch(`/api/tickets/${ticketId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: clientId,
          extraInfo: textarea.value,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "提交失败");
      activeTicket = data.ticket;
      renderTicket(activeTicket);
    } catch (e) {
      alert(e.message);
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.innerText = "确认提交客服";
    }
  };

  skipBtn.onclick = () => {
    card.remove();
    // 用户放弃确认，删除本地工单展示
    fetch(`/api/tickets/${ticketId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: clientId }),
    }).then(() => {
      activeTicket = null;
      clearMessages();
      summaryEl.innerHTML = `暂未创建工单，如需帮助请直接提问。`;
      loadTicketList();
    }).catch(() => {
      // ignore
    });
  };

  return card;
}

function renderTicket(ticket) {
  activeTicket = ticket;
  clearMessages();
  setStatus(ticket);

  if (ticket?.messages?.length) {
    ticket.messages.forEach((m) => appendBubble(m.text, m.role === "user" ? "me" : "ai"));
  }
  if (ticket?.status === "collecting") {
    const card = renderConfirmCard(ticket.structuredDraft, ticket.id);
    appendCard(card);
  }
  if (ticket?.status === "pending_cs") {
    appendBubble("工单已创建，正在为您安排客服处理，请稍候。", "ai");
  }
  if (ticket?.status === "processing" && ticket.step === "knowledge_review") {
    appendBubble("客服正在确认问题描述和检索知识，请稍等。", "ai");
  }
  if (ticket?.status === "processing" && ticket.step === "answer_review") {
    appendBubble("客服正在生成并审核回答，请稍等。", "ai");
  }
  if (ticket?.status === "done") {
    appendBubble("问题已处理完成，以下是回复：", "ai");
    appendBubble(ticket.answerFinal || ticket.answerDraft || "暂无回复", "ai");
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;

  summaryEl.innerHTML = `
    <div style="font-weight:700; margin-bottom:6px;">工单号：${ticket.id}</div>
    <div class="fade" style="margin-bottom:6px;">状态：${statusText(ticket)}</div>
    <div style="font-size:14px; line-height:1.5; white-space:pre-wrap;">${ticket.structuredFinal || ticket.structuredDraft || "待补充"}</div>
  `;
}

async function loadTicketDetail(id, acknowledge = false) {
  const resp = await fetch(`/api/tickets/${id}`);
  const data = await resp.json();
  if (resp.ok) {
    activeTicket = data.ticket;
    renderTicket(activeTicket);
    if (acknowledge) {
      await fetch(`/api/tickets/${id}/ack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: clientId }),
      });
      loadTicketList();
    }
  }
}

async function loadTicketList() {
  const resp = await fetch(`/api/tickets?userId=${clientId}`);
  const data = await resp.json();
  if (!resp.ok) return;
  ticketListEl.innerHTML = "";
  let list = (data.tickets || []).filter((t) => t.status !== "canceled");
  list = list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const filter = statusFilter.value;
  if (filter !== "all") {
    list = list.filter((t) =>
      filter === "pending_cs"
        ? t.status === "pending_cs" || t.status === "processing"
        : t.status === filter
    );
  }
  list.forEach((t) => {
    const meta = statusMeta(t);
    const item = document.createElement("div");
    item.className = "ticket-item";
    item.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; justify-content:space-between;">
        <div style="display:flex; gap:8px; align-items:center;">
          <div class="status-pill ${meta.color}">${meta.text}</div>
          ${t.newReply ? '<span class="red-dot"></span>' : ""}
        </div>
        <div class="fade" style="font-size:12px;">${new Date(t.updatedAt).toLocaleString()}</div>
      </div>
      <div style="margin-top:6px; font-weight:700;">${t.structuredFinal || t.structuredDraft || t.originalQuestion}</div>
    `;
    item.onclick = () => loadTicketDetail(t.id, true);
    ticketListEl.appendChild(item);
  });
  setMyTicketsDot(data.tickets || []);
}

async function createTicket(message) {
  const resp = await fetch("/api/tickets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: clientId, message }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || "创建失败");
  return data.ticket;
}

async function sendMessage() {
  const text = userInput.value.trim();
  if (!text) return;
  userInput.value = "";
  appendBubble(text, "me");
  try {
    const ticket = await createTicket(text);
    renderTicket(ticket);
    loadTicketList();
  } catch (e) {
    appendBubble(`发送失败：${e.message}`, "ai");
  }
}

sendBtn.onclick = sendMessage;
userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
statusFilter.addEventListener("change", () => {
  loadTicketList();
});
function toggleDrawer() {
  if (drawerPanel.classList.contains("hidden")) {
    drawerPanel.classList.remove("hidden");
    loadTicketList();
  } else {
    drawerPanel.classList.add("hidden");
  }
}
myTicketsBtn.onclick = toggleDrawer;

function setMyTicketsDot(tickets) {
  const hasNew = (tickets || []).some((t) => t.newReply);
  if (hasNew) myTicketsDot.style.display = "block";
  else myTicketsDot.style.display = "none";
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (!activeTicket) return;
    const resp = await fetch(`/api/tickets/${activeTicket.id}`);
    const data = await resp.json();
    if (resp.ok) {
      const prevStatus = activeTicket.status;
      const prevAnswer = activeTicket.answerFinal;
      activeTicket = data.ticket;
      if (prevStatus !== activeTicket.status || prevAnswer !== activeTicket.answerFinal) {
        renderTicket(activeTicket);
        loadTicketList();
      }
    }
  }, 5000);
}

function startDotPolling() {
  if (dotTimer) clearInterval(dotTimer);
  dotTimer = setInterval(async () => {
    const resp = await fetch(`/api/tickets?userId=${clientId}`);
    const data = await resp.json();
    if (resp.ok) {
      setMyTicketsDot(data.tickets || []);
    }
  }, 6000);
}

loadTicketList();
startPolling();
startDotPolling();
