import { requireAuth } from "./auth.js";
import { apiQuery } from "./api.js";
import { showToast } from "./ui.js";
import { renderSidebar } from "./nav.js";

const STAT_CARDS = [
  { key: "totalCustomers", label: "Total Customers", icon: "group", href: "/admin/users.html" },
  { key: "totalProviders", label: "Total Providers", icon: "storefront", href: "/admin/applications.html" },
  { key: "pendingApplications", label: "Pending Applications", icon: "pending_actions", href: "/admin/applications.html" },
  { key: "approvedProviders", label: "Approved Providers", icon: "verified", href: "/admin/applications.html" },
  { key: "totalBookings", label: "Total Bookings", icon: "event_available", href: "/admin/bookings.html" },
];

async function init() {
  const token = await requireAuth();
  if (!token) return;

  await renderSidebar("/admin/index.html");

  const grid = document.getElementById("stat-grid");
  grid.innerHTML = STAT_CARDS.map(
    () => `<div class="stat-card"><div class="skeleton" style="width:38px;height:38px;border-radius:10px;margin-bottom:12px;"></div><div class="skeleton" style="width:60px;height:26px;margin-bottom:6px;"></div><div class="skeleton" style="width:110px;height:14px;"></div></div>`,
  ).join("");

  try {
    const [stats, heldPayments, cancellationRequests, finance] = await Promise.all([
      apiQuery("adminVerification.stats"),
      apiQuery("admin.bookings.heldPayments").catch(() => []),
      apiQuery("admin.cancellationRequests.list", { status: "pending" }).catch(() => []),
      apiQuery("admin.finance.summary").catch(() => null),
    ]);
    const cards = [
      ...STAT_CARDS,
      { key: "heldPayments", label: "Held Payments", icon: "lock_clock", href: "/admin/held-payments.html" },
      { key: "cancellationRequests", label: "Cancellation Requests", icon: "event_busy", href: "/admin/cancellation-requests.html" },
    ];
    const values = { ...stats, heldPayments: heldPayments.length, cancellationRequests: cancellationRequests.length };
    const warnKeys = ["heldPayments", "cancellationRequests"];

    if (finance) {
      cards.push(
        { key: "gmv", label: "Total Transaction Value (GMV)", icon: "trending_up", href: "/admin/finance.html", money: true },
        { key: "platformCommission", label: "Commission Revenue", icon: "percent", href: "/admin/finance.html", money: true },
      );
      values.gmv = finance.gmv;
      values.platformCommission = finance.platformCommission;
    }

    grid.innerHTML = cards
      .map((c) => {
        const raw = values[c.key] ?? 0;
        const display = c.money ? `₦${Number(raw).toLocaleString("en-NG", { maximumFractionDigits: 0 })}` : Number(raw).toLocaleString();
        return `
      <a class="stat-card" href="${c.href}" style="display:block;${warnKeys.includes(c.key) && raw > 0 ? "border-color:var(--warning);" : ""}">
        <div class="stat-icon"><span class="material-symbols-outlined">${c.icon}</span></div>
        <div class="stat-value">${display}</div>
        <div class="stat-label">${c.label}</div>
      </a>`;
      })
      .join("");
  } catch (err) {
    showToast(err.message || "Could not load dashboard stats", "error");
  }
}

init();
