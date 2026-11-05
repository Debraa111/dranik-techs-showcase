// Single source of truth for the admin sidebar. Rendered client-side (not
// duplicated as static markup in every page) specifically because RBAC means
// different admins see different nav items — a hardcoded sidebar per page can't
// express that. Mirrors RESOURCE_ROLES in server/db.ts for display purposes only;
// the server independently enforces every permission check regardless of what
// this shows, so getting this mirror slightly stale is a UX annoyance, not a
// security hole.
import { apiQuery } from "./api.js";
import { getStoredEmail, signOut } from "./auth.js";
import { initials } from "./ui.js";

const RESOURCE_ROLES = {
  users: ["operations_admin", "support_admin"],
  providers: ["operations_admin", "support_admin"],
  bookings: ["operations_admin", "support_admin"],
  disputes: ["operations_admin", "support_admin"],
  finance: ["finance_admin"],
  categories: ["content_admin"],
};

// resource: undefined = always visible. null = super_admin only. string = gated.
const NAV_GROUPS = [
  { items: [{ href: "/admin/index.html", icon: "dashboard", label: "Dashboard" }] },
  {
    label: "Marketplace",
    items: [
      { href: "/admin/users.html", icon: "group", label: "Users", resource: "users" },
      { href: "/admin/applications.html", icon: "assignment_ind", label: "Service Providers", resource: "providers" },
      { href: "/admin/categories.html", icon: "category", label: "Categories", resource: "categories" },
      { href: "/admin/bookings.html", icon: "event_available", label: "Bookings", resource: "bookings" },
    ],
  },
  {
    label: "Finance",
    items: [
      { href: "/admin/finance.html", icon: "payments", label: "Transactions & Payments", resource: "finance" },
      { href: "/admin/held-payments.html", icon: "lock_clock", label: "Held Payments", resource: "finance" },
      { href: "/admin/commission.html", icon: "percent", label: "Commission", resource: "finance" },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/admin/cancellation-requests.html", icon: "event_busy", label: "Cancellation Requests", resource: "disputes" },
      { href: "/admin/support.html", icon: "support_agent", label: "Support Tickets", resource: "disputes" },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/admin/audit-logs.html", icon: "history", label: "Audit Logs", resource: null },
      { href: "/admin/admin-users.html", icon: "admin_panel_settings", label: "Admin Users & Roles", resource: null },
    ],
  },
];

function canAccess(roles, resource) {
  if (roles.includes("super_admin")) return true;
  if (resource === undefined) return true;
  if (resource === null) return false;
  return (RESOURCE_ROLES[resource] || []).some((r) => roles.includes(r));
}

/**
 * Renders the sidebar into #sidebar-root and the topbar user chip (if #user-email /
 * #user-avatar exist on the page). Returns { roles, email, userId } so the calling
 * page can also gate its own page-level actions/buttons for the current admin.
 */
export async function renderSidebar(activeHref) {
  const root = document.getElementById("sidebar-root");
  let roles = [];
  let email = getStoredEmail() || "";
  let userId = null;

  try {
    const me = await apiQuery("admin.me");
    roles = me.roles || [];
    email = me.email || email;
    userId = me.id;
  } catch {
    // requireAuth() (called before this, on every page) already redirects on a
    // truly invalid session — a failed roles fetch here just means "show nothing
    // gated," not "block the page."
  }

  if (root) {
    const groupsHtml = NAV_GROUPS.map((group) => {
      const items = group.items.filter((item) => canAccess(roles, item.resource));
      if (!items.length) return "";
      const label = group.label ? `<div class="nav-group-label">${group.label}</div>` : "";
      const links = items
        .map(
          (item) => `
        <a href="${item.href}" class="nav-link${item.href === activeHref ? " active" : ""}">
          <span class="material-symbols-outlined">${item.icon}</span> ${item.label}
        </a>`,
        )
        .join("");
      return `${label}${links}`;
    }).join("");

    root.innerHTML = `
      <div class="sidebar-brand">
        <div class="login-logo">DT</div>
        <span>D'RANIK Admin</span>
      </div>
      <nav class="sidebar-nav">${groupsHtml}</nav>
      <div class="sidebar-footer">
        <button class="signout" id="signout-btn">Sign out</button>
      </div>`;
    document.getElementById("signout-btn").addEventListener("click", signOut);
  }

  const emailEl = document.getElementById("user-email");
  const avatarEl = document.getElementById("user-avatar");
  if (emailEl) emailEl.textContent = email;
  if (avatarEl) avatarEl.textContent = initials((email.split("@")[0] || "").replace(/[._]/g, " "));

  return { roles, email, userId };
}

export function roleLabel(role) {
  return (
    {
      super_admin: "Super Admin",
      operations_admin: "Operations Admin",
      finance_admin: "Finance Admin",
      support_admin: "Support Admin",
      content_admin: "Content Admin",
    }[role] || role
  );
}

export { canAccess };
