import { requireAuth } from "./auth.js";
import { renderSidebar } from "./nav.js";
import { apiQuery, apiMutate } from "./api.js";
import { showToast, escapeHtml } from "./ui.js";

const PAGE_SIZE = 50;
let page = 0;
let total = 0;

function formatNaira(amount) {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return `₦${(n || 0).toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
}

function formatDateTime(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-NG", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function loadSettings() {
  try {
    const settings = await apiQuery("admin.commission.settings");
    document.getElementById("current-rate").textContent = `${Number(settings.defaultCommissionRate)}%`;
    document.getElementById("f-rate").placeholder = String(Number(settings.defaultCommissionRate));

    const feeAmount = Number(settings.bookingFeeAmount);
    document.getElementById("current-fee").textContent = settings.bookingFeeEnabled ? formatNaira(feeAmount) : "Disabled";
    document.getElementById("current-fee-label").textContent = settings.bookingFeeEnabled
      ? "Current flat fee — applies to new bookings only"
      : "Currently disabled — no fee is being charged";
    document.getElementById("f-fee-enabled").checked = settings.bookingFeeEnabled;
    document.getElementById("f-fee-amount").placeholder = feeAmount.toFixed(2);
  } catch (err) {
    showToast(err.message || "Couldn't load commission settings", "error");
  }
}

async function saveRate() {
  const rateStr = document.getElementById("f-rate").value.trim();
  const reason = document.getElementById("f-reason").value.trim();
  const rate = Number(rateStr);

  if (!rateStr || Number.isNaN(rate) || rate < 0 || rate > 100) {
    showToast("Enter a valid rate between 0 and 100.", "error");
    return;
  }
  if (reason.length < 3) {
    showToast("Please enter a reason (at least a few words).", "error");
    return;
  }
  if (!confirm(`Set the default commission rate to ${rate}%? This only applies to providers who sign up from now on.`)) return;

  try {
    await apiMutate("admin.commission.updateDefaultRate", { rate, reason });
    showToast("Default commission rate updated.", "success");
    document.getElementById("f-rate").value = "";
    document.getElementById("f-reason").value = "";
    await loadSettings();
  } catch (err) {
    showToast(err.message || "Couldn't update the rate", "error");
  }
}

async function saveFee() {
  const enabled = document.getElementById("f-fee-enabled").checked;
  const amountStr = document.getElementById("f-fee-amount").value.trim();
  const reason = document.getElementById("f-fee-reason").value.trim();
  const amount = amountStr ? Number(amountStr) : Number(document.getElementById("f-fee-amount").placeholder);

  if (Number.isNaN(amount) || amount < 0) {
    showToast("Enter a valid fee amount.", "error");
    return;
  }
  if (reason.length < 3) {
    showToast("Please enter a reason (at least a few words).", "error");
    return;
  }
  const confirmMsg = enabled
    ? `Set the booking fee to ₦${amount.toLocaleString()}? This only applies to bookings placed from now on.`
    : "Disable the booking fee? New bookings will no longer be charged one, starting now.";
  if (!confirm(confirmMsg)) return;

  try {
    await apiMutate("admin.commission.updateBookingFee", { enabled, amount, reason });
    showToast("Booking fee updated.", "success");
    document.getElementById("f-fee-amount").value = "";
    document.getElementById("f-fee-reason").value = "";
    await loadSettings();
  } catch (err) {
    showToast(err.message || "Couldn't update the booking fee", "error");
  }
}

function renderRows(rows) {
  const tbody = document.getElementById("ledger-tbody");
  const emptyState = document.getElementById("empty-state");
  if (!rows.length) {
    tbody.innerHTML = "";
    emptyState.innerHTML = `<div class="empty-state"><span class="material-symbols-outlined">percent</span><div>No released payouts match this filter yet.</div></div>`;
    return;
  }
  emptyState.innerHTML = "";
  tbody.innerHTML = rows
    .map(
      (r) => `
    <tr>
      <td>${escapeHtml(r.reference)}</td>
      <td>${escapeHtml(r.service)}</td>
      <td>${escapeHtml(r.provider)}</td>
      <td>${formatNaira(r.total)}</td>
      <td style="font-weight:700;color:var(--primary);">${formatNaira(r.commission)}</td>
      <td>${formatNaira(r.earning)}</td>
      <td>${formatDateTime(r.releasedAt)}</td>
    </tr>`,
    )
    .join("");
}

async function loadLedger() {
  const tbody = document.getElementById("ledger-tbody");
  try {
    const from = document.getElementById("f-from").value || undefined;
    const to = document.getElementById("f-to").value || undefined;
    const result = await apiQuery("admin.commission.ledger", { from, to, page });
    total = result.total;
    renderRows(result.rows);
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    document.getElementById("page-info").textContent = `${total} released payout${total === 1 ? "" : "s"} · page ${page + 1} of ${pages}`;
    document.getElementById("prev-page").disabled = page === 0;
    document.getElementById("next-page").disabled = (page + 1) * PAGE_SIZE >= total;
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding:24px;color:var(--error);">${escapeHtml(err.message)}</td></tr>`;
    showToast(err.message || "Couldn't load the commission ledger", "error");
  }
}

function wireActions() {
  document.getElementById("btn-save").addEventListener("click", saveRate);
  document.getElementById("btn-save-fee").addEventListener("click", saveFee);
  document.getElementById("f-from").addEventListener("change", () => {
    page = 0;
    loadLedger();
  });
  document.getElementById("f-to").addEventListener("change", () => {
    page = 0;
    loadLedger();
  });
  document.getElementById("prev-page").addEventListener("click", () => {
    if (page > 0) {
      page--;
      loadLedger();
    }
  });
  document.getElementById("next-page").addEventListener("click", () => {
    if ((page + 1) * PAGE_SIZE < total) {
      page++;
      loadLedger();
    }
  });
}

async function init() {
  const token = await requireAuth();
  if (!token) return;
  await renderSidebar("/admin/commission.html");
  wireActions();
  await Promise.all([loadSettings(), loadLedger()]);
}

init();
