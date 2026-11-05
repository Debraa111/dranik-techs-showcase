import { requireAuth } from "./auth.js";
import { renderSidebar } from "./nav.js";
import { apiQuery, apiMutate } from "./api.js";
import { showToast, initials, escapeHtml, formatDate } from "./ui.js";

const DOC_LABELS = {
  government_id: "Government ID",
  selfie: "Selfie Verification",
  certificate: "Professional Certificate",
  address_proof: "Address Proof",
  portfolio: "Portfolio",
  other: "Other document",
};

const STATUS_BADGE = {
  pending: ["badge-pending", "Pending"],
  verified: ["badge-verified", "Verified"],
  rejected: ["badge-rejected", "Rejected"],
  unverified: ["badge-unverified", "Unverified"],
};

let applications = [];
let currentProviderId = null;

function statusBadge(status) {
  const [cls, label] = STATUS_BADGE[status] ?? STATUS_BADGE.unverified;
  return `<span class="badge ${cls}">${label}</span>`;
}

function applicantName(row) {
  const legal = [row.profile.firstName, row.profile.lastName].filter(Boolean).join(" ");
  return legal || row.user.name || "Unnamed applicant";
}

function renderTable() {
  const tbody = document.getElementById("applications-tbody");
  const emptyState = document.getElementById("empty-state");
  document.getElementById("app-count").textContent = applications.length
    ? `${applications.length} pending`
    : "";

  if (applications.length === 0) {
    tbody.innerHTML = "";
    emptyState.style.display = "block";
    emptyState.innerHTML = `
      <div class="empty-state">
        <span class="material-symbols-outlined">task_alt</span>
        <div>No pending applications right now.</div>
      </div>`;
    return;
  }
  emptyState.style.display = "none";

  tbody.innerHTML = applications
    .map((row) => {
      const name = applicantName(row);
      const avatarUrl = row.user.avatarUrl;
      const avatar = avatarUrl
        ? `<img class="avatar" src="${escapeHtml(avatarUrl)}" alt="" />`
        : `<div class="avatar">${initials(name)}</div>`;
      return `
        <tr data-provider-id="${row.profile.id}">
          <td>
            <div class="applicant-cell">
              ${avatar}
              <div>
                <div class="applicant-name">${escapeHtml(name)}</div>
                <div class="applicant-sub">${escapeHtml(row.profile.email || row.user.email || "—")}</div>
              </div>
            </div>
          </td>
          <td>${escapeHtml(row.profile.businessName || "—")}</td>
          <td>${escapeHtml(row.category || "No services yet")}</td>
          <td>${escapeHtml(row.profile.phone || row.user.phone || "—")}</td>
          <td>${row.profile.yearsOfExperience ?? 0} yrs</td>
          <td>${statusBadge(row.profile.verificationStatus)}</td>
        </tr>`;
    })
    .join("");

  tbody.querySelectorAll("tr").forEach((tr) => {
    tr.addEventListener("click", () => openDetail(Number(tr.dataset.providerId)));
  });
}

async function loadApplications() {
  const tbody = document.getElementById("applications-tbody");
  try {
    applications = await apiQuery("adminVerification.pending");
    renderTable();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="padding:24px;color:var(--error);">${escapeHtml(err.message)}</td></tr>`;
  }
}

/* ---------------- Detail modal ---------------- */

function openDetail(providerId) {
  const row = applications.find((r) => r.profile.id === providerId);
  if (!row) return;
  currentProviderId = providerId;

  document.getElementById("detail-title").textContent = row.profile.businessName || applicantName(row);

  const rows = [
    ["Full name", applicantName(row)],
    ["Email", row.profile.email || row.user.email || "—"],
    ["Phone", row.profile.phone || row.user.phone || "—"],
    ["Business name", row.profile.businessName || "—"],
    ["Service category", row.category || "No services added yet"],
    ["Years of experience", `${row.profile.yearsOfExperience ?? 0} years`],
    ["Location", [row.profile.city, row.profile.state].filter(Boolean).join(", ") || "—"],
    ["Business registration (CAC)", row.profile.cacRegistrationNumber || "Not provided"],
    ["Submitted", formatDate(row.profile.createdAt)],
    ["Status", ""],
  ];

  document.getElementById("detail-info").innerHTML = rows
    .map(([label, value]) =>
      label === "Status"
        ? `<div class="detail-row"><span class="label">${label}</span><span class="value">${statusBadge(row.profile.verificationStatus)}</span></div>`
        : `<div class="detail-row"><span class="label">${label}</span><span class="value">${escapeHtml(value)}</span></div>`,
    )
    .join("");

  document.getElementById("detail-docs").innerHTML = `<div class="skeleton" style="height:56px;"></div>`;
  document.getElementById("detail-overlay").classList.add("visible");
  loadDocuments(providerId);
}

async function loadDocuments(providerId) {
  const container = document.getElementById("detail-docs");
  try {
    const docs = await apiQuery("adminVerification.documents", { providerId });
    if (docs.length === 0) {
      container.innerHTML = `<div style="font-size:13px;color:var(--muted);">No documents submitted yet.</div>`;
      return;
    }
    container.innerHTML = docs
      .map((doc) => {
        const label = DOC_LABELS[doc.type] ?? doc.type;
        const isImage = /\.(jpe?g|png|webp|gif)$/i.test(doc.fileUrl || "") || /^image\//.test(doc.mimeType || "");
        const thumb = isImage
          ? `<img class="doc-thumb" src="${escapeHtml(doc.fileUrl)}" alt="" />`
          : `<div class="doc-thumb" style="display:flex;align-items:center;justify-content:center;"><span class="material-symbols-outlined" style="color:var(--muted);">description</span></div>`;
        return `
        <a class="doc-item" href="${escapeHtml(doc.fileUrl)}" target="_blank" rel="noopener">
          ${thumb}
          <div class="doc-info">
            <div class="doc-type">${escapeHtml(label)}${doc.idType ? ` (${escapeHtml(doc.idType.replace(/_/g, " "))})` : ""}</div>
            <div class="doc-status">${escapeHtml(doc.status)} · ${formatDate(doc.createdAt)}</div>
          </div>
          <span class="material-symbols-outlined" style="color:var(--muted);">open_in_new</span>
        </a>`;
      })
      .join("");
  } catch (err) {
    container.innerHTML = `<div style="font-size:13px;color:var(--error);">${escapeHtml(err.message)}</div>`;
  }
}

function closeDetail() {
  document.getElementById("detail-overlay").classList.remove("visible");
  currentProviderId = null;
}

/* ---------------- Action modal (Approve / Reject / Request Info) ---------------- */

let pendingAction = null;

function openAction({ title, desc, showReason, reasonLabel, reasonRequired, confirmLabel, confirmClass, onConfirm }) {
  document.getElementById("action-title").textContent = title;
  document.getElementById("action-desc").textContent = desc;
  const reasonField = document.getElementById("action-reason-field");
  const reasonInput = document.getElementById("action-reason");
  reasonInput.value = "";
  if (showReason) {
    reasonField.style.display = "block";
    document.getElementById("action-reason-label").textContent = reasonLabel;
  } else {
    reasonField.style.display = "none";
  }

  const confirmBtn = document.getElementById("action-confirm");
  confirmBtn.textContent = confirmLabel;
  confirmBtn.className = `btn btn-sm ${confirmClass}`;

  pendingAction = { onConfirm, showReason, reasonRequired };
  document.getElementById("action-overlay").classList.add("visible");
}

function closeAction() {
  document.getElementById("action-overlay").classList.remove("visible");
  pendingAction = null;
}

async function handleActionConfirm() {
  if (!pendingAction) return;
  const reasonInput = document.getElementById("action-reason");
  const reason = reasonInput.value.trim();

  if (pendingAction.showReason && pendingAction.reasonRequired && !reason) {
    reasonInput.focus();
    showToast("Please enter a message before sending.", "error");
    return;
  }

  const confirmBtn = document.getElementById("action-confirm");
  confirmBtn.disabled = true;
  try {
    await pendingAction.onConfirm(reason);
    closeAction();
  } catch (err) {
    showToast(err.message || "Something went wrong", "error");
  } finally {
    confirmBtn.disabled = false;
  }
}

/* ---------------- Wire up actions ---------------- */

function wireActions() {
  document.getElementById("btn-approve").addEventListener("click", () => {
    openAction({
      title: "Approve this application?",
      desc: "The provider will be notified and can immediately start accepting bookings.",
      showReason: false,
      confirmLabel: "Approve",
      confirmClass: "btn-success",
      onConfirm: async () => {
        await apiMutate("adminVerification.decide", { providerId: currentProviderId, decision: "verified" });
        showToast("Application approved.", "success");
        closeDetail();
        await loadApplications();
      },
    });
  });

  document.getElementById("btn-reject").addEventListener("click", () => {
    openAction({
      title: "Reject this application?",
      desc: "The provider will be notified. You can add an optional reason below.",
      showReason: true,
      reasonLabel: "Reason (optional)",
      reasonRequired: false,
      confirmLabel: "Reject",
      confirmClass: "btn-danger",
      onConfirm: async (reason) => {
        await apiMutate("adminVerification.decide", {
          providerId: currentProviderId,
          decision: "rejected",
          rejectionReason: reason || undefined,
        });
        showToast("Application rejected.", "success");
        closeDetail();
        await loadApplications();
      },
    });
  });

  document.getElementById("btn-request-info").addEventListener("click", () => {
    openAction({
      title: "Request more information",
      desc: "Sends the provider a notification with your message. The application stays pending.",
      showReason: true,
      reasonLabel: "Message to provider",
      reasonRequired: true,
      confirmLabel: "Send",
      confirmClass: "btn-primary",
      onConfirm: async (message) => {
        await apiMutate("adminVerification.requestInfo", { providerId: currentProviderId, message });
        showToast("Message sent to provider.", "success");
        closeDetail();
      },
    });
  });

  document.getElementById("detail-close").addEventListener("click", closeDetail);
  document.getElementById("detail-overlay").addEventListener("click", (e) => {
    if (e.target.id === "detail-overlay") closeDetail();
  });
  document.getElementById("action-close").addEventListener("click", closeAction);
  document.getElementById("action-cancel").addEventListener("click", closeAction);
  document.getElementById("action-overlay").addEventListener("click", (e) => {
    if (e.target.id === "action-overlay") closeAction();
  });
  document.getElementById("action-confirm").addEventListener("click", handleActionConfirm);
}

async function init() {
  const token = await requireAuth();
  if (!token) return;

  await renderSidebar("/admin/applications.html");

  wireActions();
  await loadApplications();
}

init();
