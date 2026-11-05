import { requireAuth } from "./auth.js";
import { renderSidebar } from "./nav.js";
import { apiQuery, apiMutate } from "./api.js";
import { showToast, escapeHtml, formatDate } from "./ui.js";

let requests = [];
let currentRequestId = null;

function formatNaira(amount) {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return `₦${n.toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
}

function renderTable() {
  const tbody = document.getElementById("requests-tbody");
  const emptyState = document.getElementById("empty-state");
  document.getElementById("request-count").textContent = requests.length ? `${requests.length} pending` : "";

  if (requests.length === 0) {
    tbody.innerHTML = "";
    emptyState.style.display = "block";
    emptyState.innerHTML = `
      <div class="empty-state">
        <span class="material-symbols-outlined">task_alt</span>
        <div>No cancellation requests waiting on review.</div>
      </div>`;
    return;
  }
  emptyState.style.display = "none";

  tbody.innerHTML = requests
    .map((row) => {
      return `
        <tr data-request-id="${row.request.id}">
          <td>${escapeHtml(row.booking.reference)}</td>
          <td>${escapeHtml(row.service.title)}</td>
          <td>${row.request.requestedByRole === "customer" ? "Customer" : "Provider"}</td>
          <td>${escapeHtml(row.provider.businessName || "—")}</td>
          <td>${escapeHtml(row.customer.name || "—")}</td>
          <td>${formatNaira(row.booking.total)}</td>
          <td>${formatDate(row.request.createdAt)}</td>
        </tr>`;
    })
    .join("");

  tbody.querySelectorAll("tr").forEach((tr) => {
    tr.addEventListener("click", () => openDetail(Number(tr.dataset.requestId)));
  });
}

async function loadRequests() {
  const tbody = document.getElementById("requests-tbody");
  try {
    requests = await apiQuery("admin.cancellationRequests.list", { status: "pending" });
    renderTable();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding:24px;color:var(--error);">${escapeHtml(err.message)}</td></tr>`;
  }
}

/* ---------------- Detail modal ---------------- */

function openDetail(requestId) {
  const row = requests.find((r) => r.request.id === requestId);
  if (!row) return;
  currentRequestId = requestId;

  document.getElementById("detail-title").textContent = row.booking.reference;

  const rows = [
    ["Service", row.service.title],
    ["Provider", row.provider.businessName || "—"],
    ["Customer", row.customer.name || "—"],
    ["Booking total", formatNaira(row.booking.total)],
    ["Requested by", row.request.requestedByRole === "customer" ? "Customer" : "Provider"],
    ["Requested", formatDate(row.request.createdAt)],
  ];

  document.getElementById("detail-info").innerHTML = rows
    .map(([label, value]) => `<div class="detail-row"><span class="label">${label}</span><span class="value">${escapeHtml(value)}</span></div>`)
    .join("");
  document.getElementById("detail-reason").textContent = row.request.reason;

  document.getElementById("detail-overlay").classList.add("visible");
}

function closeDetail() {
  document.getElementById("detail-overlay").classList.remove("visible");
  currentRequestId = null;
}

/* ---------------- Reject modal ---------------- */

function openReject() {
  document.getElementById("reject-reason").value = "";
  document.getElementById("reject-overlay").classList.add("visible");
}

function closeReject() {
  document.getElementById("reject-overlay").classList.remove("visible");
}

async function handleRejectConfirm() {
  const reasonInput = document.getElementById("reject-reason");
  const note = reasonInput.value.trim();
  if (note.length < 3) {
    reasonInput.focus();
    showToast("Please enter a reason (at least a few words) before rejecting.", "error");
    return;
  }

  const confirmBtn = document.getElementById("reject-confirm");
  confirmBtn.disabled = true;
  try {
    await apiMutate("admin.cancellationRequests.decide", { requestId: currentRequestId, decision: "reject", reviewNote: note });
    showToast("Request rejected. The booking continues as normal.", "success");
    closeReject();
    closeDetail();
    await loadRequests();
  } catch (err) {
    showToast(err.message || "Something went wrong", "error");
  } finally {
    confirmBtn.disabled = false;
  }
}

/* ---------------- Approve modal ---------------- */

function currentRow() {
  return requests.find((r) => r.request.id === currentRequestId);
}

function openApprove() {
  const row = currentRow();
  if (!row) return;
  const total = Number(row.booking.total);
  document.getElementById("approve-total").textContent = `Booking total: ${formatNaira(total)}`;
  document.querySelector('input[name="split-mode"][value="full_refund"]').checked = true;
  document.getElementById("custom-split-fields").style.display = "none";
  document.getElementById("custom-refund").value = "";
  document.getElementById("custom-payout").value = "";
  document.getElementById("split-error").style.display = "none";
  document.getElementById("approve-note").value = "";
  document.getElementById("approve-overlay").classList.add("visible");
}

function closeApprove() {
  document.getElementById("approve-overlay").classList.remove("visible");
}

function wireSplitModeToggle() {
  document.querySelectorAll('input[name="split-mode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      document.getElementById("custom-split-fields").style.display = radio.value === "custom" && radio.checked ? "flex" : "none";
    });
  });
}

/** Resolves the chosen split mode into { refundAmount, providerPayoutAmount }, or null if invalid. */
function resolveSplit(total) {
  const mode = document.querySelector('input[name="split-mode"]:checked')?.value;
  const errorEl = document.getElementById("split-error");
  errorEl.style.display = "none";

  if (mode === "full_refund") return { refundAmount: total, providerPayoutAmount: 0 };
  if (mode === "full_payout") return { refundAmount: 0, providerPayoutAmount: total };

  const refundAmount = parseFloat(document.getElementById("custom-refund").value || "0");
  const providerPayoutAmount = parseFloat(document.getElementById("custom-payout").value || "0");
  if (Number.isNaN(refundAmount) || Number.isNaN(providerPayoutAmount) || refundAmount < 0 || providerPayoutAmount < 0) {
    errorEl.textContent = "Enter valid, non-negative amounts.";
    errorEl.style.display = "block";
    return null;
  }
  if (refundAmount + providerPayoutAmount > total) {
    errorEl.textContent = `Refund + payout can't exceed the booking total (${formatNaira(total)}).`;
    errorEl.style.display = "block";
    return null;
  }
  return { refundAmount, providerPayoutAmount };
}

async function handleApproveConfirm() {
  const row = currentRow();
  if (!row) return;
  const total = Number(row.booking.total);
  const split = resolveSplit(total);
  if (!split) return;

  const note = document.getElementById("approve-note").value.trim();
  const confirmBtn = document.getElementById("approve-confirm");
  confirmBtn.disabled = true;
  try {
    await apiMutate("admin.cancellationRequests.decide", {
      requestId: currentRequestId,
      decision: "approve",
      reviewNote: note || undefined,
      refundAmount: split.refundAmount,
      providerPayoutAmount: split.providerPayoutAmount,
    });
    showToast("Cancellation approved. The booking is now cancelled.", "success");
    closeApprove();
    closeDetail();
    await loadRequests();
  } catch (err) {
    showToast(err.message || "Something went wrong", "error");
  } finally {
    confirmBtn.disabled = false;
  }
}

/* ---------------- Wire up ---------------- */

function wireActions() {
  document.getElementById("btn-reject").addEventListener("click", openReject);
  document.getElementById("btn-approve").addEventListener("click", openApprove);
  document.getElementById("detail-close").addEventListener("click", closeDetail);
  document.getElementById("detail-overlay").addEventListener("click", (e) => {
    if (e.target.id === "detail-overlay") closeDetail();
  });

  document.getElementById("reject-close").addEventListener("click", closeReject);
  document.getElementById("reject-cancel").addEventListener("click", closeReject);
  document.getElementById("reject-overlay").addEventListener("click", (e) => {
    if (e.target.id === "reject-overlay") closeReject();
  });
  document.getElementById("reject-confirm").addEventListener("click", handleRejectConfirm);

  document.getElementById("approve-close").addEventListener("click", closeApprove);
  document.getElementById("approve-cancel").addEventListener("click", closeApprove);
  document.getElementById("approve-overlay").addEventListener("click", (e) => {
    if (e.target.id === "approve-overlay") closeApprove();
  });
  document.getElementById("approve-confirm").addEventListener("click", handleApproveConfirm);
  wireSplitModeToggle();
}

async function init() {
  const token = await requireAuth();
  if (!token) return;

  await renderSidebar("/admin/cancellation-requests.html");

  wireActions();
  await loadRequests();
}

init();
