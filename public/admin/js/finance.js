import { requireAuth } from "./auth.js";
import { renderSidebar } from "./nav.js";
import { apiQuery } from "./api.js";
import { showToast, escapeHtml, formatDate } from "./ui.js";

const PAGE_SIZE = 50;
let page = 0;
let total = 0;

function formatNaira(amount) {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return `₦${(n || 0).toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
}

async function loadSummary() {
  const grid = document.getElementById("summary-grid");
  grid.innerHTML = Array.from({ length: 4 })
    .map(() => `<div class="stat-card"><div class="skeleton" style="width:38px;height:38px;border-radius:10px;margin-bottom:12px;"></div><div class="skeleton" style="width:80px;height:26px;margin-bottom:6px;"></div><div class="skeleton" style="width:110px;height:14px;"></div></div>`)
    .join("");
  try {
    const s = await apiQuery("admin.finance.summary");
    const cards = [
      { icon: "trending_up", label: "Total Transaction Value (GMV)", value: formatNaira(s.gmv) },
      { icon: "percent", label: "Platform Commission Revenue", value: formatNaira(s.platformCommission) },
      { icon: "receipt_long", label: "Booking Fees Collected", value: formatNaira(s.bookingFeesCollected) },
      { icon: "payments", label: "Provider Earnings (Released)", value: formatNaira(s.providerEarnings) },
      { icon: "undo", label: "Total Refunds", value: formatNaira(s.refunds) },
      { icon: "check_circle", label: "Successful Payments", value: s.payments.successful.toLocaleString() },
      { icon: "hourglass_empty", label: "Pending Payments", value: s.payments.pending.toLocaleString() },
      { icon: "error_outline", label: "Failed Payments", value: s.payments.failed.toLocaleString() },
      { icon: "replay", label: "Refunded Payments", value: s.payments.refunded.toLocaleString() },
    ];
    grid.innerHTML = cards
      .map(
        (c) => `
      <div class="stat-card">
        <div class="stat-icon"><span class="material-symbols-outlined">${c.icon}</span></div>
        <div class="stat-value">${c.value}</div>
        <div class="stat-label">${c.label}</div>
      </div>`,
      )
      .join("");
  } catch (err) {
    showToast(err.message || "Couldn't load finance summary", "error");
  }
}

function renderRows(rows) {
  const tbody = document.getElementById("payments-tbody");
  const emptyState = document.getElementById("empty-state");
  if (!rows.length) {
    tbody.innerHTML = "";
    emptyState.innerHTML = `<div class="empty-state"><span class="material-symbols-outlined">receipt_long</span><div>No payments match this filter.</div></div>`;
    return;
  }
  emptyState.innerHTML = "";
  tbody.innerHTML = rows
    .map(
      (r) => `
    <tr>
      <td>${escapeHtml(r.payment.gatewayReference || `#${r.payment.id}`)}</td>
      <td>${escapeHtml(r.customer?.name || "—")}</td>
      <td>${escapeHtml(r.booking?.reference || "—")}</td>
      <td>${formatNaira(r.payment.amount)}</td>
      <td style="text-transform:capitalize;">${escapeHtml(r.payment.method)}</td>
      <td><span class="badge badge-${r.payment.status}">${escapeHtml(r.payment.status)}</span></td>
      <td>${formatDate(r.payment.createdAt)}</td>
    </tr>`,
    )
    .join("");
}

async function loadPayments() {
  const tbody = document.getElementById("payments-tbody");
  try {
    const status = document.getElementById("f-status").value || undefined;
    const result = await apiQuery("admin.finance.payments", { status, page });
    total = result.total;
    renderRows(result.rows);
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    document.getElementById("page-info").textContent = `${total} payment${total === 1 ? "" : "s"} · page ${page + 1} of ${pages}`;
    document.getElementById("prev-page").disabled = page === 0;
    document.getElementById("next-page").disabled = (page + 1) * PAGE_SIZE >= total;
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding:24px;color:var(--error);">${escapeHtml(err.message)}</td></tr>`;
  }
}

function wireActions() {
  document.getElementById("f-status").addEventListener("change", () => {
    page = 0;
    loadPayments();
  });
  document.getElementById("prev-page").addEventListener("click", () => {
    if (page > 0) {
      page--;
      loadPayments();
    }
  });
  document.getElementById("next-page").addEventListener("click", () => {
    if ((page + 1) * PAGE_SIZE < total) {
      page++;
      loadPayments();
    }
  });
}

async function init() {
  const token = await requireAuth();
  if (!token) return;
  await renderSidebar("/admin/finance.html");
  wireActions();
  await Promise.all([loadSummary(), loadPayments()]);
}

init();
