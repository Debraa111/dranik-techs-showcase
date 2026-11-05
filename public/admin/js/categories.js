import { requireAuth } from "./auth.js";
import { renderSidebar } from "./nav.js";
import { apiQuery, apiMutate } from "./api.js";
import { showToast, escapeHtml } from "./ui.js";

let categories = [];
let editingId = null;

function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function render() {
  const tbody = document.getElementById("cat-tbody");
  const emptyState = document.getElementById("empty-state");
  if (!categories.length) {
    tbody.innerHTML = "";
    emptyState.innerHTML = `<div class="empty-state"><span class="material-symbols-outlined">category</span><div>No categories yet.</div></div>`;
    return;
  }
  emptyState.innerHTML = "";
  tbody.innerHTML = categories
    .map(
      (c) => `
    <tr>
      <td style="font-weight:700;">${escapeHtml(c.name)}</td>
      <td style="color:var(--muted);">${escapeHtml(c.slug)}</td>
      <td>${c.activeServiceCount}</td>
      <td>${c.sortOrder}</td>
      <td><span class="badge ${c.isActive ? "badge-verified" : "badge-unverified"}">${c.isActive ? "Active" : "Inactive"}</span></td>
      <td style="text-align:right;white-space:nowrap;">
        <button class="link-btn" data-edit="${c.id}">Edit</button>
        &nbsp;·&nbsp;
        <button class="link-btn" data-toggle="${c.id}" style="${c.isActive ? "color:var(--error);" : "color:var(--success);"}">${c.isActive ? "Deactivate" : "Reactivate"}</button>
      </td>
    </tr>`,
    )
    .join("");

  tbody.querySelectorAll("[data-edit]").forEach((btn) => btn.addEventListener("click", (e) => { e.stopPropagation(); openEdit(Number(btn.dataset.edit)); }));
  tbody.querySelectorAll("[data-toggle]").forEach((btn) => btn.addEventListener("click", (e) => { e.stopPropagation(); toggleActive(Number(btn.dataset.toggle)); }));
}

async function load() {
  try {
    categories = await apiQuery("admin.categories.list");
    render();
  } catch (err) {
    showToast(err.message || "Couldn't load categories", "error");
  }
}

function openEdit(id) {
  editingId = id;
  const c = categories.find((x) => x.id === id);
  document.getElementById("edit-title").textContent = c ? "Edit category" : "New category";
  document.getElementById("f-name").value = c?.name ?? "";
  document.getElementById("f-slug").value = c?.slug ?? "";
  document.getElementById("f-description").value = c?.description ?? "";
  document.getElementById("f-icon").value = c?.icon ?? "";
  document.getElementById("f-sort").value = c?.sortOrder ?? "0";
  document.getElementById("edit-overlay").classList.add("visible");
}

async function toggleActive(id) {
  const c = categories.find((x) => x.id === id);
  if (!c) return;
  if (c.isActive && c.activeServiceCount > 0) {
    const ok = confirm(`${c.activeServiceCount} active service(s) use "${c.name}". Deactivate anyway? New bookings for those services won't be affected, but the category will stop showing in browse/search.`);
    if (!ok) return;
  }
  try {
    await apiMutate("admin.categories.update", { id, isActive: !c.isActive });
    showToast(c.isActive ? "Category deactivated." : "Category reactivated.", "success");
    await load();
  } catch (err) {
    showToast(err.message || "Couldn't update category", "error");
  }
}

async function save() {
  const name = document.getElementById("f-name").value.trim();
  const slugInput = document.getElementById("f-slug").value.trim();
  const slug = slugInput || slugify(name);
  const description = document.getElementById("f-description").value.trim();
  const icon = document.getElementById("f-icon").value.trim();
  const sortOrder = Number(document.getElementById("f-sort").value) || 0;

  if (name.length < 2) {
    showToast("Please enter a category name.", "error");
    return;
  }
  if (!/^[a-z0-9-]+$/.test(slug)) {
    showToast("Slug must be lowercase letters, numbers, and hyphens only.", "error");
    return;
  }

  try {
    if (editingId) {
      await apiMutate("admin.categories.update", { id: editingId, name, slug, description: description || undefined, icon: icon || undefined, sortOrder });
    } else {
      await apiMutate("admin.categories.create", { name, slug, description: description || undefined, icon: icon || undefined, sortOrder });
    }
    showToast("Category saved.", "success");
    document.getElementById("edit-overlay").classList.remove("visible");
    await load();
  } catch (err) {
    showToast(err.message || "Couldn't save category", "error");
  }
}

function wireActions() {
  document.getElementById("btn-new").addEventListener("click", () => openEdit(null));
  document.getElementById("edit-close").addEventListener("click", () => document.getElementById("edit-overlay").classList.remove("visible"));
  document.getElementById("edit-cancel").addEventListener("click", () => document.getElementById("edit-overlay").classList.remove("visible"));
  document.getElementById("edit-overlay").addEventListener("click", (e) => {
    if (e.target.id === "edit-overlay") e.currentTarget.classList.remove("visible");
  });
  document.getElementById("edit-save").addEventListener("click", save);
}

async function init() {
  const token = await requireAuth();
  if (!token) return;
  await renderSidebar("/admin/categories.html");
  wireActions();
  await load();
}

init();
