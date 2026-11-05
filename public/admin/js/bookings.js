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

function statusBadgeClass(status) {
  if (status === "completed") return "badge-verified";
  if (status === "cancelled" || status === "rejected") return "badge-rejected";
  if (status === "pending") return "badge-pending";
  return "badge-unverified";
}

function filters() {
  return {
    search: document.getElementById("f-search").value.trim() || undefined,
    status: document.getElementById("f-status").value || undefined,
    page,
  };
}

function renderRows(rows) {
  const tbody = document.getElementById("bookings-tbody");
  const emptyState = document.getElementById("empty-state");
  if (!rows.length) {
    tbody.innerHTML = "";
    emptyState.innerHTML = `<div class="empty-state"><span class="material-symbols-outlined">event_busy</span><div>No bookings match these filters.</div></div>`;
    return;
  }
  emptyState.innerHTML = "";
  tbody.innerHTML = rows
    .map(
      (r) => `
    <tr data-id="${r.booking.id}">
      <td>${escapeHtml(r.booking.reference)}</td>
      <td>${escapeHtml(r.service.title)}</td>
      <td>${escapeHtml(r.customer.name || "—")}</td>
      <td>${escapeHtml(r.provider.businessName)}</td>
      <td>${formatNaira(r.booking.total)}</td>
      <td><span class="badge ${statusBadgeClass(r.booking.status)}">${escapeHtml(r.booking.status)}</span></td>
      <td style="text-transform:capitalize;">${escapeHtml(r.booking.paymentStatus)}</td>
      <td>${escapeHtml(r.booking.scheduledDate)} ${escapeHtml(r.booking.scheduledTime)}</td>
    </tr>`,
    )
    .join("");
  tbody.querySelectorAll("tr").forEach((tr) => tr.addEventListener("click", () => openDetail(Number(tr.dataset.id))));
}

async function loadBookings() {
  const tbody = document.getElementById("bookings-tbody");
  try {
    const result = await apiQuery("admin.bookings.list", filters());
    total = result.total;
    renderRows(result.rows);
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    document.getElementById("page-info").textContent = `${total} booking${total === 1 ? "" : "s"} · page ${page + 1} of ${pages}`;
    document.getElementById("prev-page").disabled = page === 0;
    document.getElementById("next-page").disabled = (page + 1) * PAGE_SIZE >= total;
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" style="padding:24px;color:var(--error);">${escapeHtml(err.message)}</td></tr>`;
  }
}

async function openDetail(id) {
  const body = document.getElementById("detail-body");
  document.getElementById("detail-title").textContent = "Loading…";
  body.innerHTML = `<div class="skeleton" style="height:200px;"></div>`;
  document.getElementById("detail-overlay").classList.add("visible");

  try {
    const d = await apiQuery("admin.bookings.detail", { id });
    if (!d) {
      body.innerHTML = `<div class="empty-state">Booking not found.</div>`;
      return;
    }
    document.getElementById("detail-title").textContent = d.booking.reference;

    const infoRows = [
      ["Service", d.service.title],
      ["Customer", d.customer.name || "—"],
      ["Provider", d.provider.businessName],
      ["Total", formatNaira(d.booking.total)],
      ["Status", d.booking.status],
      ["Payment status", d.booking.paymentStatus],
      ["Payout status", d.booking.payoutStatus || "—"],
      ["Scheduled", `${d.booking.scheduledDate} ${d.booking.scheduledTime}`],
      ["Cancel reason", d.booking.cancelReason || "—"],
    ];

    const historyHtml = d.history.length
      ? d.history.map((h) => `<div class="detail-row"><span class="label">${escapeHtml(h.fromStatus)} → ${escapeHtml(h.toStatus)}</span><span class="value">${formatDate(h.createdAt)}</span></div>`).join("")
      : `<div style="color:var(--muted);font-size:13px;">No status history.</div>`;

    const progressHtml = d.progress.length
      ? d.progress.map((p) => `<div class="detail-row"><span class="label">${escapeHtml(p.type)}</span><span class="value">${formatDate(p.createdAt)}</span></div>`).join("")
      : `<div style="color:var(--muted);font-size:13px;">No checkpoints posted.</div>`;

    const paymentsHtml = d.payments.length
      ? d.payments.map((p) => `<div class="detail-row"><span class="label">${escapeHtml(p.method)} · ${escapeHtml(p.status)}</span><span class="value">${formatNaira(p.amount)}</span></div>`).join("")
      : `<div style="color:var(--muted);font-size:13px;">No payment records.</div>`;

    const cancellationHtml = d.cancellationRequests.length
      ? d.cancellationRequests.map((c) => `<div class="detail-row"><span class="label">${escapeHtml(c.requestedByRole)} · ${escapeHtml(c.status)}</span><span class="value">${formatDate(c.createdAt)}</span></div>`).join("")
      : `<div style="color:var(--muted);font-size:13px;">No cancellation requests.</div>`;

    body.innerHTML = `
      <div class="section-label">Booking</div>
      ${infoRows.map(([l, v]) => `<div class="detail-row"><span class="label">${l}</span><span class="value">${escapeHtml(String(v))}</span></div>`).join("")}
      <div class="section-label">Status history</div>
      ${historyHtml}
      <div class="section-label">Progress checkpoints</div>
      ${progressHtml}
      <div class="section-label">Payments</div>
      ${paymentsHtml}
      <div class="section-label">Cancellation requests</div>
      ${cancellationHtml}
      ${
        d.booking.status === "completed" && d.booking.payoutStatus === "held"
          ? `<div style="margin-top:14px;"><a class="btn btn-outline btn-sm" href="/admin/held-payments.html">Manage in Held Payments →</a></div>`
          : ""
      }
      ${
        d.cancellationRequests.some((c) => c.status === "pending")
          ? `<div style="margin-top:10px;"><a class="btn btn-outline btn-sm" href="/admin/cancellation-requests.html">Manage in Cancellation Requests →</a></div>`
          : ""
      }
    `;
  } catch (err) {
    body.innerHTML = `<div style="color:var(--error);">${escapeHtml(err.message)}</div>`;
    showToast(err.message || "Couldn't load booking", "error");
  }
}

function wireActions() {
  document.getElementById("detail-close").addEventListener("click", () => document.getElementById("detail-overlay").classList.remove("visible"));
  document.getElementById("detail-overlay").addEventListener("click", (e) => {
    if (e.target.id === "detail-overlay") e.currentTarget.classList.remove("visible");
  });

  let searchTimer;
  document.getElementById("f-search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      page = 0;
      loadBookings();
    }, 350);
  });
  document.getElementById("f-status").addEventListener("change", () => {
    page = 0;
    loadBookings();
  });
  document.getElementById("prev-page").addEventListener("click", () => {
    if (page > 0) {
      page--;
      loadBookings();
    }
  });
  document.getElementById("next-page").addEventListener("click", () => {
    if ((page + 1) * PAGE_SIZE < total) {
      page++;
      loadBookings();
    }
  });
}

async function init() {
  const token = await requireAuth();
  if (!token) return;
  await renderSidebar("/admin/bookings.html");
  wireActions();
  await loadBookings();
}

init();
