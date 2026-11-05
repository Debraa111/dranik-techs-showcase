import { requireAuth } from "./auth.js";
import { renderSidebar } from "./nav.js";
import { apiQuery, apiMutate } from "./api.js";
import { showToast, escapeHtml, formatDate } from "./ui.js";

const PAGE_SIZE = 50;
let page = 0;
let total = 0;
let tickets = [];
let admins = [];
let currentTicketId = null;

const PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 };

function filters() {
  return {
    status: document.getElementById("f-status").value || undefined,
    priority: document.getElementById("f-priority").value || undefined,
    page,
  };
}

function renderRows() {
  const tbody = document.getElementById("tickets-tbody");
  const emptyState = document.getElementById("empty-state");
  if (!tickets.length) {
    tbody.innerHTML = "";
    emptyState.innerHTML = `<div class="empty-state"><span class="material-symbols-outlined">support_agent</span><div>No support tickets match these filters.</div></div>`;
    return;
  }
  emptyState.innerHTML = "";
  tbody.innerHTML = tickets
    .map(({ ticket, submittedBy }) => {
      const assignee = admins.find((a) => a.id === ticket.assignedToUserId);
      return `
    <tr data-id="${ticket.id}">
      <td style="font-weight:700;">${escapeHtml(ticket.subject)}</td>
      <td>${escapeHtml(submittedBy.name || submittedBy.email || "—")}</td>
      <td style="text-transform:capitalize;">${escapeHtml(ticket.category)}</td>
      <td style="text-transform:capitalize;">${escapeHtml(ticket.priority)}</td>
      <td><span class="badge badge-${ticket.status}">${escapeHtml(ticket.status.replace("_", " "))}</span></td>
      <td>${assignee ? escapeHtml(assignee.name || assignee.email) : "—"}</td>
      <td>${formatDate(ticket.createdAt)}</td>
    </tr>`;
    })
    .join("");
  tbody.querySelectorAll("tr").forEach((tr) => tr.addEventListener("click", () => openDetail(Number(tr.dataset.id))));
}

async function loadAdmins() {
  try {
    admins = await apiQuery("admin.support.assignableAdmins");
    const select = document.getElementById("f-edit-assignee");
    select.innerHTML =
      `<option value="">Unassigned</option>` +
      admins.map((a) => `<option value="${a.id}">${escapeHtml(a.name || a.email)}</option>`).join("");
  } catch {
    // Non-fatal — assignment dropdown just stays empty; triage still works without it.
  }
}

async function loadTickets() {
  const tbody = document.getElementById("tickets-tbody");
  try {
    const result = await apiQuery("admin.support.list", filters());
    total = result.total;
    tickets = result.rows.slice().sort((a, b) => PRIORITY_ORDER[a.ticket.priority] - PRIORITY_ORDER[b.ticket.priority]);
    renderRows();
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    document.getElementById("page-info").textContent = `${total} ticket${total === 1 ? "" : "s"} · page ${page + 1} of ${pages}`;
    document.getElementById("prev-page").disabled = page === 0;
    document.getElementById("next-page").disabled = (page + 1) * PAGE_SIZE >= total;
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding:24px;color:var(--error);">${escapeHtml(err.message)}</td></tr>`;
  }
}

function openDetail(id) {
  const row = tickets.find((r) => r.ticket.id === id);
  if (!row) return;
  currentTicketId = id;
  const { ticket, submittedBy } = row;

  document.getElementById("detail-title").textContent = ticket.subject;
  document.getElementById("detail-meta").innerHTML = `<div class="detail-row"><span class="label">${escapeHtml(submittedBy.name || "—")}</span><span class="value">${escapeHtml(submittedBy.email || "—")}</span></div>`;
  document.getElementById("detail-description").textContent = ticket.description;
  document.getElementById("f-edit-status").value = ticket.status;
  document.getElementById("f-edit-priority").value = ticket.priority;
  document.getElementById("f-edit-assignee").value = ticket.assignedToUserId ?? "";
  document.getElementById("f-edit-notes").value = ticket.internalNotes || "";

  document.getElementById("detail-overlay").classList.add("visible");
}

async function saveTicket() {
  const status = document.getElementById("f-edit-status").value;
  const priority = document.getElementById("f-edit-priority").value;
  const assigneeRaw = document.getElementById("f-edit-assignee").value;
  const internalNotes = document.getElementById("f-edit-notes").value;

  try {
    await apiMutate("admin.support.update", {
      id: currentTicketId,
      status,
      priority,
      assignedToUserId: assigneeRaw ? Number(assigneeRaw) : null,
      internalNotes,
    });
    showToast("Ticket updated.", "success");
    document.getElementById("detail-overlay").classList.remove("visible");
    await loadTickets();
  } catch (err) {
    showToast(err.message || "Couldn't update ticket", "error");
  }
}

function wireActions() {
  document.getElementById("detail-close").addEventListener("click", () => document.getElementById("detail-overlay").classList.remove("visible"));
  document.getElementById("detail-cancel").addEventListener("click", () => document.getElementById("detail-overlay").classList.remove("visible"));
  document.getElementById("detail-overlay").addEventListener("click", (e) => {
    if (e.target.id === "detail-overlay") e.currentTarget.classList.remove("visible");
  });
  document.getElementById("detail-save").addEventListener("click", saveTicket);

  document.getElementById("f-status").addEventListener("change", () => {
    page = 0;
    loadTickets();
  });
  document.getElementById("f-priority").addEventListener("change", () => {
    page = 0;
    loadTickets();
  });
  document.getElementById("prev-page").addEventListener("click", () => {
    if (page > 0) {
      page--;
      loadTickets();
    }
  });
  document.getElementById("next-page").addEventListener("click", () => {
    if ((page + 1) * PAGE_SIZE < total) {
      page++;
      loadTickets();
    }
  });
}

async function init() {
  const token = await requireAuth();
  if (!token) return;
  await renderSidebar("/admin/support.html");
  wireActions();
  await loadAdmins();
  await loadTickets();
}

init();
