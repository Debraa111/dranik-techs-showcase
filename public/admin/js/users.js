import { requireAuth } from "./auth.js";
import { renderSidebar } from "./nav.js";
import { apiQuery, apiMutate } from "./api.js";
import { showToast, escapeHtml, formatDate, initials } from "./ui.js";

const PAGE_SIZE = 50;
let page = 0;
let total = 0;
let currentUser = null;
let pendingStatus = null;
let myRoles = [];
let deletePreview = null;

function formatNaira(amount) {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return `₦${(n || 0).toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
}

function filters() {
  return {
    search: document.getElementById("f-search").value.trim() || undefined,
    status: document.getElementById("f-status").value || undefined,
    appRole: document.getElementById("f-role").value || undefined,
    page,
  };
}

function renderRows(rows) {
  const tbody = document.getElementById("users-tbody");
  const emptyState = document.getElementById("empty-state");
  if (!rows.length) {
    tbody.innerHTML = "";
    emptyState.innerHTML = `<div class="empty-state"><span class="material-symbols-outlined">group_off</span><div>No users match these filters.</div></div>`;
    return;
  }
  emptyState.innerHTML = "";
  tbody.innerHTML = rows
    .map(
      (u) => `
    <tr data-id="${u.id}">
      <td>
        <div class="applicant-cell">
          <div class="avatar">${initials(u.name)}</div>
          <div>
            <div class="applicant-name">${escapeHtml(u.name || "Unnamed")}</div>
            <div class="applicant-sub">${escapeHtml(u.email || u.phone || "—")}</div>
          </div>
        </div>
      </td>
      <td style="text-transform:capitalize;">${escapeHtml(u.appRole)}</td>
      <td><span class="badge badge-${u.status}">${escapeHtml(u.status)}</span></td>
      <td>${formatDate(u.createdAt)}</td>
      <td>${formatDate(u.lastSignedIn)}</td>
    </tr>`,
    )
    .join("");
  tbody.querySelectorAll("tr").forEach((tr) => tr.addEventListener("click", () => openDetail(Number(tr.dataset.id))));
}

async function loadUsers() {
  const tbody = document.getElementById("users-tbody");
  try {
    const result = await apiQuery("admin.users.list", filters());
    total = result.total;
    renderRows(result.rows);
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    document.getElementById("page-info").textContent = `${total} user${total === 1 ? "" : "s"} · page ${page + 1} of ${pages}`;
    document.getElementById("prev-page").disabled = page === 0;
    document.getElementById("next-page").disabled = (page + 1) * PAGE_SIZE >= total;
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="padding:24px;color:var(--error);">${escapeHtml(err.message)}</td></tr>`;
  }
}

function statusActions(user) {
  // Terminal state — a permanently-deleted account has no email/phone/name left
  // to "reactivate" into, and it can never be un-deleted.
  if (user.status === "deleted") return "";
  const actions = [];
  if (user.status !== "active") actions.push(["active", "Reactivate", "btn-success"]);
  if (user.status !== "suspended") actions.push(["suspended", "Suspend", "btn-danger"]);
  if (user.status !== "deactivated") actions.push(["deactivated", "Deactivate", "btn-outline"]);
  return actions
    .map(([status, label, cls]) => `<button class="btn ${cls} btn-sm" data-status="${status}">${label}</button>`)
    .join("");
}

async function openDetail(id) {
  const body = document.getElementById("detail-body");
  document.getElementById("detail-title").textContent = "Loading…";
  body.innerHTML = `<div class="skeleton" style="height:200px;"></div>`;
  document.getElementById("detail-overlay").classList.add("visible");

  try {
    const detail = await apiQuery("admin.users.detail", { id });
    if (!detail) {
      body.innerHTML = `<div class="empty-state">User not found.</div>`;
      return;
    }
    currentUser = detail.user;
    document.getElementById("detail-title").textContent = detail.user.name || detail.user.email || `User #${id}`;

    const infoRows = [
      ["Email", detail.user.email || "—"],
      ["Phone", detail.user.phone || "—"],
      ["Type", detail.user.appRole],
      ["Status", detail.user.status],
      ["Joined", formatDate(detail.user.createdAt)],
      ["Wallet balance", detail.wallet ? formatNaira(detail.wallet.balance) : "—"],
    ];

    const bookingsHtml = detail.bookings.length
      ? detail.bookings
          .slice(0, 8)
          .map((b) => `<div class="detail-row"><span class="label">${escapeHtml(b.service.title)}</span><span class="value">${escapeHtml(b.booking.status)}</span></div>`)
          .join("")
      : `<div style="color:var(--muted);font-size:13px;">No bookings.</div>`;

    const ticketsHtml = detail.supportTickets.length
      ? detail.supportTickets
          .map((t) => `<div class="detail-row"><span class="label">${escapeHtml(t.subject)}</span><span class="value">${escapeHtml(t.status)}</span></div>`)
          .join("")
      : `<div style="color:var(--muted);font-size:13px;">No support tickets.</div>`;

    const reviewsHtml = detail.reviews.length
      ? detail.reviews
          .map((r) => `<div class="detail-row"><span class="label">${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</span><span class="value">${formatDate(r.createdAt)}</span></div>`)
          .join("")
      : `<div style="color:var(--muted);font-size:13px;">No reviews written.</div>`;

    body.innerHTML = `
      <div class="section-label">Account</div>
      ${infoRows.map(([l, v]) => `<div class="detail-row"><span class="label">${l}</span><span class="value">${escapeHtml(String(v))}</span></div>`).join("")}
      <div class="section-label">Recent bookings</div>
      ${bookingsHtml}
      <div class="section-label">Support tickets</div>
      ${ticketsHtml}
      <div class="section-label">Reviews written</div>
      ${reviewsHtml}
      <div class="section-label">Actions</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">${statusActions(detail.user)}</div>
      ${dangerZoneHtml(detail)}
    `;
    body.querySelectorAll("[data-status]").forEach((btn) =>
      btn.addEventListener("click", () => openStatusModal(btn.dataset.status)),
    );
    const deleteBtn = body.querySelector("#open-permanent-delete");
    if (deleteBtn) deleteBtn.addEventListener("click", openDeleteModal);
  } catch (err) {
    body.innerHTML = `<div style="color:var(--error);">${escapeHtml(err.message)}</div>`;
  }
}

/** Permanent delete is only ever offered to super_admin (matches the server-side
 *  RBAC gate — see admin.users.permanentDelete not being listed in RESOURCE_ROLES),
 *  and never for an account that already is a provider or is already deleted. */
function dangerZoneHtml(detail) {
  if (!myRoles.includes("super_admin")) return "";
  if (detail.user.status === "deleted") return "";
  if (detail.providerProfile) {
    return `
      <div class="section-label">Danger zone</div>
      <div style="font-size:12.5px;color:var(--muted);">Permanent delete isn't available for provider accounts yet.</div>
    `;
  }
  return `
    <div class="section-label">Danger zone</div>
    <button class="btn btn-danger btn-sm" id="open-permanent-delete">Permanently delete account…</button>
  `;
}

function openStatusModal(status) {
  pendingStatus = status;
  document.getElementById("status-title").textContent =
    status === "active" ? "Reactivate this user?" : status === "suspended" ? "Suspend this user?" : "Deactivate this user?";
  document.getElementById("status-reason").value = "";
  document.getElementById("status-overlay").classList.add("visible");
}

async function openDeleteModal() {
  deletePreview = null;
  document.getElementById("delete-email-target").textContent = currentUser.email || "(no email on file)";
  document.getElementById("delete-confirm-email").value = "";
  document.getElementById("delete-reason").value = "";
  document.getElementById("delete-preview").innerHTML = `<div class="skeleton" style="height:80px;"></div>`;
  document.getElementById("delete-blocked").style.display = "none";
  document.getElementById("delete-fields").style.display = "block";
  document.getElementById("delete-confirm").disabled = true;
  document.getElementById("delete-overlay").classList.add("visible");

  try {
    const preview = await apiQuery("admin.users.deletionPreview", { id: currentUser.id });
    deletePreview = preview;
    document.getElementById("delete-preview").innerHTML = `
      <div class="delete-preview-row"><span class="label">Bookings on file</span><span>${preview.totalBookings}</span></div>
      <div class="delete-preview-row"><span class="label">Reviews written</span><span>${preview.totalReviews}</span></div>
      <div class="delete-preview-row"><span class="label">Wallet balance</span><span>${formatNaira(preview.walletBalance)}</span></div>
    `;
    if (!preview.canDelete) {
      document.getElementById("delete-blocked").style.display = "block";
      document.getElementById("delete-blocked").textContent = preview.blockedReasons.join(" ");
      document.getElementById("delete-fields").style.display = "none";
    } else {
      document.getElementById("delete-confirm").disabled = false;
    }
  } catch (err) {
    document.getElementById("delete-preview").innerHTML = "";
    document.getElementById("delete-blocked").style.display = "block";
    document.getElementById("delete-blocked").textContent = err.message || "Couldn't load this account's deletion preview.";
    document.getElementById("delete-fields").style.display = "none";
  }
}

async function confirmDelete() {
  if (!deletePreview || !deletePreview.canDelete) return;
  const confirmEmail = document.getElementById("delete-confirm-email").value.trim();
  const reason = document.getElementById("delete-reason").value.trim();
  if (!currentUser.email || confirmEmail.toLowerCase() !== currentUser.email.toLowerCase()) {
    showToast("Type the account's email exactly to confirm.", "error");
    return;
  }
  if (reason.length < 3) {
    showToast("Please enter a reason (at least a few words).", "error");
    return;
  }
  try {
    const result = await apiMutate("admin.users.permanentDelete", { id: currentUser.id, confirmEmail, reason });
    showToast(
      result.supabaseAuthDeleted
        ? "Account permanently deleted."
        : "Account deleted here, but its Supabase Auth identity couldn't be removed — check the server logs / SUPABASE_SERVICE_ROLE_KEY.",
      result.supabaseAuthDeleted ? "success" : "error",
    );
    document.getElementById("delete-overlay").classList.remove("visible");
    document.getElementById("detail-overlay").classList.remove("visible");
    await loadUsers();
  } catch (err) {
    showToast(err.message || "Couldn't delete this account", "error");
  }
}

async function confirmStatusChange() {
  const reason = document.getElementById("status-reason").value.trim();
  if (reason.length < 3) {
    showToast("Please enter a reason (at least a few words).", "error");
    return;
  }
  try {
    await apiMutate("admin.users.setStatus", { id: currentUser.id, status: pendingStatus, reason });
    showToast("User status updated.", "success");
    document.getElementById("status-overlay").classList.remove("visible");
    document.getElementById("detail-overlay").classList.remove("visible");
    await loadUsers();
  } catch (err) {
    showToast(err.message || "Couldn't update status", "error");
  }
}

function wireActions() {
  document.getElementById("detail-close").addEventListener("click", () => document.getElementById("detail-overlay").classList.remove("visible"));
  document.getElementById("detail-overlay").addEventListener("click", (e) => {
    if (e.target.id === "detail-overlay") e.currentTarget.classList.remove("visible");
  });
  document.getElementById("status-close").addEventListener("click", () => document.getElementById("status-overlay").classList.remove("visible"));
  document.getElementById("status-cancel").addEventListener("click", () => document.getElementById("status-overlay").classList.remove("visible"));
  document.getElementById("status-overlay").addEventListener("click", (e) => {
    if (e.target.id === "status-overlay") e.currentTarget.classList.remove("visible");
  });
  document.getElementById("status-confirm").addEventListener("click", confirmStatusChange);

  document.getElementById("delete-close").addEventListener("click", () => document.getElementById("delete-overlay").classList.remove("visible"));
  document.getElementById("delete-cancel").addEventListener("click", () => document.getElementById("delete-overlay").classList.remove("visible"));
  document.getElementById("delete-overlay").addEventListener("click", (e) => {
    if (e.target.id === "delete-overlay") e.currentTarget.classList.remove("visible");
  });
  document.getElementById("delete-confirm").addEventListener("click", confirmDelete);

  let searchTimer;
  document.getElementById("f-search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      page = 0;
      loadUsers();
    }, 350);
  });
  document.getElementById("f-status").addEventListener("change", () => {
    page = 0;
    loadUsers();
  });
  document.getElementById("f-role").addEventListener("change", () => {
    page = 0;
    loadUsers();
  });
  document.getElementById("prev-page").addEventListener("click", () => {
    if (page > 0) {
      page--;
      loadUsers();
    }
  });
  document.getElementById("next-page").addEventListener("click", () => {
    if ((page + 1) * PAGE_SIZE < total) {
      page++;
      loadUsers();
    }
  });
}

async function init() {
  const token = await requireAuth();
  if (!token) return;
  const me = await renderSidebar("/admin/users.html");
  myRoles = me.roles || [];
  wireActions();
  await loadUsers();
}

init();
