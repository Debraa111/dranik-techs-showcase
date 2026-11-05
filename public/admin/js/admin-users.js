import { requireAuth } from "./auth.js";
import { renderSidebar, roleLabel } from "./nav.js";
import { apiQuery, apiMutate } from "./api.js";
import { showToast, escapeHtml, formatDate, initials } from "./ui.js";

const ALL_ROLES = ["super_admin", "operations_admin", "finance_admin", "support_admin", "content_admin"];

let admins = [];
let currentUserId = null;

function render() {
  const tbody = document.getElementById("admins-tbody");
  const emptyState = document.getElementById("empty-state");
  if (!admins.length) {
    tbody.innerHTML = "";
    emptyState.innerHTML = `<div class="empty-state"><span class="material-symbols-outlined">admin_panel_settings</span><div>No admin accounts yet.</div></div>`;
    return;
  }
  emptyState.innerHTML = "";
  tbody.innerHTML = admins
    .map((a) => {
      const chips = a.roles
        .map(
          (r) => `
        <span class="role-chip">${roleLabel(r)}
          ${a.id === currentUserId && r === "super_admin" ? "" : `<button data-remove-role="${r}" data-user="${a.id}" title="Remove role">&times;</button>`}
        </span>`,
        )
        .join("");
      const addableRoles = ALL_ROLES.filter((r) => !a.roles.includes(r));
      const addSelect = addableRoles.length
        ? `<select data-add-role="${a.id}" style="font-size:12px;padding:4px 6px;border-radius:6px;border:1px solid var(--border);">
            <option value="">+ Add role…</option>
            ${addableRoles.map((r) => `<option value="${r}">${roleLabel(r)}</option>`).join("")}
          </select>`
        : "";

      return `
    <tr>
      <td>
        <div class="applicant-cell">
          <div class="avatar">${initials(a.name)}</div>
          <div>
            <div class="applicant-name">${escapeHtml(a.name || "Unnamed")}</div>
            <div class="applicant-sub">${escapeHtml(a.email || "—")}</div>
          </div>
        </div>
      </td>
      <td>${chips || `<span style="color:var(--muted);font-size:12.5px;">No specific roles</span>`}<div style="margin-top:6px;">${addSelect}</div></td>
      <td>${formatDate(a.createdAt)}</td>
      <td style="text-align:right;white-space:nowrap;">
        ${
          a.id === currentUserId
            ? `<span style="color:var(--muted);font-size:12px;">(you)</span>`
            : `<button class="link-btn" data-deactivate="${a.id}" style="color:var(--error);">Revoke admin access</button>`
        }
      </td>
    </tr>`;
    })
    .join("");

  tbody.querySelectorAll("[data-remove-role]").forEach((btn) =>
    btn.addEventListener("click", () => removeRole(Number(btn.dataset.user), btn.dataset.removeRole)),
  );
  tbody.querySelectorAll("[data-add-role]").forEach((select) =>
    select.addEventListener("change", (e) => {
      if (e.target.value) addRole(Number(select.dataset.addRole), e.target.value);
    }),
  );
  tbody.querySelectorAll("[data-deactivate]").forEach((btn) =>
    btn.addEventListener("click", () => revokeAccess(Number(btn.dataset.deactivate))),
  );
}

async function load() {
  try {
    admins = await apiQuery("admin.adminUsers.list");
    render();
  } catch (err) {
    showToast(err.message || "Couldn't load admin accounts", "error");
  }
}

async function addRole(userId, role) {
  try {
    await apiMutate("admin.adminUsers.assignRole", { userId, role });
    showToast("Role granted.", "success");
    await load();
  } catch (err) {
    showToast(err.message || "Couldn't grant role", "error");
  }
}

async function removeRole(userId, role) {
  if (!confirm(`Remove the ${roleLabel(role)} role from this admin?`)) return;
  try {
    await apiMutate("admin.adminUsers.removeRole", { userId, role });
    showToast("Role removed.", "success");
    await load();
  } catch (err) {
    showToast(err.message || "Couldn't remove role", "error");
  }
}

async function revokeAccess(userId) {
  if (!confirm("Revoke this account's admin dashboard access entirely? All their roles will be cleared.")) return;
  try {
    await apiMutate("admin.adminUsers.setActive", { userId, active: false });
    showToast("Admin access revoked.", "success");
    await load();
  } catch (err) {
    showToast(err.message || "Couldn't revoke access", "error");
  }
}

async function grantAccess() {
  const email = document.getElementById("grant-email").value.trim();
  const role = document.getElementById("grant-role").value;
  if (!email) {
    showToast("Enter the user's email first.", "error");
    return;
  }
  try {
    const user = await apiQuery("admin.adminUsers.findByEmail", { email });
    if (!user) {
      showToast("No D'RANIK account found with that email — they need to sign up in the app first.", "error");
      return;
    }
    await apiMutate("admin.adminUsers.assignRole", { userId: user.id, role });
    showToast(`${roleLabel(role)} granted to ${user.name || user.email}.`, "success");
    document.getElementById("grant-email").value = "";
    await load();
  } catch (err) {
    showToast(err.message || "Couldn't grant access", "error");
  }
}

async function init() {
  const token = await requireAuth();
  if (!token) return;
  const me = await renderSidebar("/admin/admin-users.html");
  currentUserId = me.userId;
  document.getElementById("btn-grant").addEventListener("click", grantAccess);
  await load();
}

init();
