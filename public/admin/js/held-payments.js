import { requireAuth } from "./auth.js";
import { renderSidebar } from "./nav.js";
import { apiQuery, apiMutate } from "./api.js";
import { showToast, escapeHtml, formatDate } from "./ui.js";

/** Mirrors RELEASE_CODE_MAX_ATTEMPTS in src/server/db.ts. */
const RELEASE_CODE_MAX_ATTEMPTS = 5;

let heldPayments = [];
let currentBookingId = null;

function formatNaira(amount) {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return `₦${n.toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
}

function daysAgo(date) {
  if (!date) return "—";
  const ms = Date.now() - new Date(date).getTime();
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days < 1) return "today";
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function expiryLabel(date) {
  if (!date) return "—";
  const expired = new Date(date).getTime() < Date.now();
  return expired ? `<span style="color:var(--error);">Expired</span>` : formatDate(date);
}

function renderTable() {
  const tbody = document.getElementById("held-tbody");
  const emptyState = document.getElementById("empty-state");
  document.getElementById("held-count").textContent = heldPayments.length ? `${heldPayments.length} held` : "";

  if (heldPayments.length === 0) {
    tbody.innerHTML = "";
    emptyState.style.display = "block";
    emptyState.innerHTML = `
      <div class="empty-state">
        <span class="material-symbols-outlined">task_alt</span>
        <div>No held payments right now — everything's been released.</div>
      </div>`;
    return;
  }
  emptyState.style.display = "none";

  tbody.innerHTML = heldPayments
    .map((row) => {
      const attemptsLocked = row.booking.releaseCodeAttempts >= RELEASE_CODE_MAX_ATTEMPTS;
      return `
        <tr data-booking-id="${row.booking.id}">
          <td>${escapeHtml(row.booking.reference)}</td>
          <td>${escapeHtml(row.service.title)}</td>
          <td>${escapeHtml(row.provider.businessName || "—")}</td>
          <td>${escapeHtml(row.customer.name || "—")}</td>
          <td>${formatNaira(row.booking.total)}</td>
          <td>${daysAgo(row.booking.completedAt)}</td>
          <td style="${attemptsLocked ? "color:var(--error);font-weight:600;" : ""}">
            ${row.booking.releaseCodeAttempts}/${RELEASE_CODE_MAX_ATTEMPTS}${attemptsLocked ? " (locked)" : ""}
          </td>
          <td>${expiryLabel(row.booking.releaseCodeExpiresAt)}</td>
        </tr>`;
    })
    .join("");

  tbody.querySelectorAll("tr").forEach((tr) => {
    tr.addEventListener("click", () => openDetail(Number(tr.dataset.bookingId)));
  });
}

async function loadHeldPayments() {
  const tbody = document.getElementById("held-tbody");
  try {
    heldPayments = await apiQuery("admin.bookings.heldPayments");
    renderTable();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" style="padding:24px;color:var(--error);">${escapeHtml(err.message)}</td></tr>`;
  }
}

/* ---------------- Detail modal ---------------- */

function openDetail(bookingId) {
  const row = heldPayments.find((r) => r.booking.id === bookingId);
  if (!row) return;
  currentBookingId = bookingId;

  document.getElementById("detail-title").textContent = row.booking.reference;

  const total = Number(row.booking.total);
  const commissionRate = Number(row.provider.commissionRate ?? 10);
  const commission = Math.round(total * (commissionRate / 100) * 100) / 100;
  const earning = Math.round((total - commission) * 100) / 100;

  const rows = [
    ["Service", row.service.title],
    ["Provider", row.provider.businessName || "—"],
    ["Customer", row.customer.name || "—"],
    ["Total paid", formatNaira(total)],
    ["Commission", `${formatNaira(commission)} (${commissionRate}%)`],
    ["Provider gets", formatNaira(earning)],
    ["Completed", formatDate(row.booking.completedAt)],
    ["Code attempts", `${row.booking.releaseCodeAttempts}/${RELEASE_CODE_MAX_ATTEMPTS}`],
    ["Code expires", formatDate(row.booking.releaseCodeExpiresAt)],
  ];

  document.getElementById("detail-info").innerHTML = rows
    .map(([label, value]) => `<div class="detail-row"><span class="label">${label}</span><span class="value">${escapeHtml(value)}</span></div>`)
    .join("");

  document.getElementById("detail-overlay").classList.add("visible");
}

function closeDetail() {
  document.getElementById("detail-overlay").classList.remove("visible");
  currentBookingId = null;
}

/* ---------------- Release confirm modal ---------------- */

function openAction() {
  document.getElementById("action-reason").value = "";
  document.getElementById("action-overlay").classList.add("visible");
}

function closeAction() {
  document.getElementById("action-overlay").classList.remove("visible");
}

async function handleReleaseConfirm() {
  const reasonInput = document.getElementById("action-reason");
  const note = reasonInput.value.trim();
  if (note.length < 3) {
    reasonInput.focus();
    showToast("Please enter a reason (at least a few words) before releasing.", "error");
    return;
  }

  const confirmBtn = document.getElementById("action-confirm");
  confirmBtn.disabled = true;
  try {
    await apiMutate("admin.bookings.releasePayment", { bookingId: currentBookingId, note });
    showToast("Payment released.", "success");
    closeAction();
    closeDetail();
    await loadHeldPayments();
  } catch (err) {
    showToast(err.message || "Something went wrong", "error");
  } finally {
    confirmBtn.disabled = false;
  }
}

/* ---------------- Wire up ---------------- */

function wireActions() {
  document.getElementById("btn-release").addEventListener("click", openAction);
  document.getElementById("detail-close").addEventListener("click", closeDetail);
  document.getElementById("detail-overlay").addEventListener("click", (e) => {
    if (e.target.id === "detail-overlay") closeDetail();
  });
  document.getElementById("action-close").addEventListener("click", closeAction);
  document.getElementById("action-cancel").addEventListener("click", closeAction);
  document.getElementById("action-overlay").addEventListener("click", (e) => {
    if (e.target.id === "action-overlay") closeAction();
  });
  document.getElementById("action-confirm").addEventListener("click", handleReleaseConfirm);
}

async function init() {
  const token = await requireAuth();
  if (!token) return;

  await renderSidebar("/admin/held-payments.html");

  wireActions();
  await loadHeldPayments();
}

init();
