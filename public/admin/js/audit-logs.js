import { requireAuth } from "./auth.js";
import { renderSidebar } from "./nav.js";
import { apiQuery } from "./api.js";
import { showToast, escapeHtml } from "./ui.js";

const PAGE_SIZE = 50;
let page = 0;
let total = 0;

function formatDateTime(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-NG", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function loadActions() {
  try {
    const actions = await apiQuery("admin.auditLogs.actions");
    const select = document.getElementById("f-action");
    select.innerHTML = `<option value="">All actions</option>` + actions.map((a) => `<option value="${a}">${escapeHtml(a)}</option>`).join("");
  } catch {
    // Non-fatal — the action filter just stays as "All actions."
  }
}

function filters() {
  return {
    action: document.getElementById("f-action").value || undefined,
    entityType: document.getElementById("f-entity-type").value.trim() || undefined,
    from: document.getElementById("f-from").value || undefined,
    to: document.getElementById("f-to").value || undefined,
    page,
  };
}

function renderRows(rows) {
  const tbody = document.getElementById("logs-tbody");
  const emptyState = document.getElementById("empty-state");
  if (!rows.length) {
    tbody.innerHTML = "";
    emptyState.innerHTML = `<div class="empty-state"><span class="material-symbols-outlined">history</span><div>No audit log entries match these filters.</div></div>`;
    return;
  }
  emptyState.innerHTML = "";
  tbody.innerHTML = rows
    .map(({ log, actorName, actorEmail }) => {
      let detailStr = "—";
      if (log.detail) {
        try {
          detailStr = JSON.stringify(log.detail);
          if (detailStr.length > 80) detailStr = detailStr.slice(0, 77) + "…";
        } catch {
          detailStr = "—";
        }
      }
      return `
    <tr>
      <td style="white-space:nowrap;">${formatDateTime(log.createdAt)}</td>
      <td>${escapeHtml(actorName || actorEmail || (log.userId ? `#${log.userId}` : "System"))}</td>
      <td><code style="font-size:12px;background:var(--background);padding:2px 6px;border-radius:5px;">${escapeHtml(log.action)}</code></td>
      <td>${escapeHtml(log.entityType || "—")}${log.entityId ? ` #${log.entityId}` : ""}</td>
      <td style="color:var(--muted);font-size:12px;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(detailStr)}">${escapeHtml(detailStr)}</td>
    </tr>`;
    })
    .join("");
}

async function loadLogs() {
  const tbody = document.getElementById("logs-tbody");
  try {
    const result = await apiQuery("admin.auditLogs.list", filters());
    total = result.total;
    renderRows(result.rows);
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    document.getElementById("page-info").textContent = `${total} entr${total === 1 ? "y" : "ies"} · page ${page + 1} of ${pages}`;
    document.getElementById("prev-page").disabled = page === 0;
    document.getElementById("next-page").disabled = (page + 1) * PAGE_SIZE >= total;
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="padding:24px;color:var(--error);">${escapeHtml(err.message)}</td></tr>`;
    showToast(err.message || "Couldn't load audit logs", "error");
  }
}

function wireActions() {
  ["f-action", "f-entity-type", "f-from", "f-to"].forEach((id) => {
    document.getElementById(id).addEventListener("change", () => {
      page = 0;
      loadLogs();
    });
  });
  document.getElementById("prev-page").addEventListener("click", () => {
    if (page > 0) {
      page--;
      loadLogs();
    }
  });
  document.getElementById("next-page").addEventListener("click", () => {
    if ((page + 1) * PAGE_SIZE < total) {
      page++;
      loadLogs();
    }
  });
}

async function init() {
  const token = await requireAuth();
  if (!token) return;
  await renderSidebar("/admin/audit-logs.html");
  wireActions();
  await loadActions();
  await loadLogs();
}

init();
