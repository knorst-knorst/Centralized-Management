const state = {
  settings: [],
  groups: [],
  selectedGroup: "",
  search: "",
  deleteId: null,
  editingSecret: false,
  apiKey: sessionStorage.getItem("keyledger-api-key") || "",
  keyPromptOpen: false
};

const byId = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[character]));
const icon = (name) => `<svg class="icon"><use href="#i-${name}"/></svg>`;

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");
  if (options.body) headers.set("Content-Type", "application/json");
  if (state.apiKey) headers.set("X-Api-Key", state.apiKey);

  const response = await fetch(path, { ...options, headers });
  if (response.status === 401) {
    state.keyPromptOpen = true;
    byId("keyDialog").showModal();
    throw new Error("Enter an API key to continue.");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const validation = body.errors && Object.values(body.errors).flat().join(" ");
    throw new Error(body.error || validation || `Request failed (${response.status}).`);
  }
  return response.status === 204 ? null : response.json();
}

function toast(message, isError = false) {
  const item = document.createElement("div");
  item.className = `toast${isError ? " error" : ""}`;
  item.textContent = message;
  byId("toastRegion").append(item);
  window.setTimeout(() => item.remove(), 3200);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "2-digit" }).format(date);
}

function visibleSettings() {
  return state.settings.filter((setting) => {
    const matchesGroup = !state.selectedGroup || setting.group === state.selectedGroup;
    const search = state.search.trim().toLowerCase();
    const matchesSearch = !search || setting.key.toLowerCase().includes(search)
      || setting.group.toLowerCase().includes(search);
    return matchesGroup && matchesSearch;
  });
}

function renderGroups() {
  const groups = [...state.groups].sort((left, right) => left.name.localeCompare(right.name));
  byId("groupList").innerHTML = groups.map((group) => `
    <button class="group-link${state.selectedGroup === group.name ? " is-active" : ""}" type="button" data-group="${escapeHtml(group.name)}">
      <span class="group-symbol">${escapeHtml(group.name.slice(0, 1).toUpperCase())}</span>
      <span class="group-link-label">${escapeHtml(group.name)}</span><span class="group-link-count">${group.count}</span>
    </button>`).join("");

  const options = groups.map((group) => `<option value="${escapeHtml(group.name)}">${escapeHtml(group.name)}</option>`).join("");
  const filter = byId("groupFilter");
  const exportFilter = byId("exportGroup");
  const knownGroups = byId("knownGroups");
  const oldFilter = filter.value;
  const oldExport = exportFilter.value;
  filter.innerHTML = `<option value="">All groups</option>${options}`;
  exportFilter.innerHTML = `<option value="">All groups</option>${options}`;
  knownGroups.innerHTML = groups.map((group) => `<option value="${escapeHtml(group.name)}"></option>`).join("");
  filter.value = oldFilter;
  exportFilter.value = oldExport;
}

function renderSettings() {
  const settings = visibleSettings();
  const rows = byId("settingsRows");
  rows.innerHTML = settings.map((setting, index) => `
    <tr style="animation-delay:${Math.min(index * 20, 160)}ms">
      <td><div class="group-cell"><span class="group-chip">${escapeHtml(setting.group.slice(0, 1).toUpperCase())}</span>${escapeHtml(setting.group)}</div></td>
      <td><code class="key-value">${escapeHtml(setting.key)}</code></td>
      <td class="value-cell" title="${setting.isSecret ? "Protected value" : escapeHtml(setting.value)}">${setting.isSecret ? `<span class="secret-value">${icon("lock")}••••••••</span>` : escapeHtml(setting.value || "(empty)")}</td>
      <td><span class="type-pill${setting.isSecret ? " protected" : ""}">${setting.isSecret ? "PROTECTED" : "PLAIN TEXT"}</span></td>
      <td class="updated-cell settings-updated">${formatDate(setting.updatedAtUtc)}</td>
      <td><div class="row-actions"><button class="row-action" type="button" data-edit="${setting.id}" title="Edit ${escapeHtml(setting.key)}" aria-label="Edit ${escapeHtml(setting.key)}">${icon("arrow")}</button><button class="row-action delete" type="button" data-delete="${setting.id}" title="Delete ${escapeHtml(setting.key)}" aria-label="Delete ${escapeHtml(setting.key)}">${icon("trash")}</button></div></td>
    </tr>`).join("");

  byId("emptyState").hidden = settings.length > 0;
  byId("visibleCount").textContent = settings.length;
  byId("tableSummary").textContent = `Showing ${settings.length} of ${state.settings.length} settings`;
  byId("registryTitle").firstChild.textContent = state.selectedGroup ? `${state.selectedGroup} ` : "All settings ";
}

function updateOverview() {
  byId("totalMetric").textContent = state.settings.length;
  byId("groupMetric").textContent = state.groups.length;
  byId("secretMetric").textContent = state.settings.filter((setting) => setting.isSecret).length;
  byId("navTotal").textContent = state.settings.length;
  byId("lastSync").textContent = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date());
}

async function loadData() {
  try {
    const [settings, groups, status] = await Promise.all([
      api("/api/settings"), api("/api/groups"), api("/api/status")
    ]);
    state.settings = settings;
    state.groups = groups;
    renderGroups();
    updateOverview();
    renderSettings();
    byId("connectionLabel").textContent = "Connected";
    byId("databaseLabel").textContent = `${status.database} · ready`;
    byId("connectionDot").classList.remove("is-offline");
    byId("apiState").textContent = status.apiKeyRequired ? "Key protected" : "Available";
  } catch (error) {
    if (error.message !== "Enter an API key to continue.") {
      byId("connectionLabel").textContent = "Unavailable";
      byId("databaseLabel").textContent = "Check server connection";
      byId("connectionDot").classList.add("is-offline");
      if (state.settings.length === 0) byId("apiState").textContent = "Offline";
      toast(error.message, true);
    }
  }
}

function openSetting(setting = null) {
  state.editingSecret = Boolean(setting?.isSecret);
  byId("settingId").value = setting?.id ?? "";
  byId("settingGroup").value = setting?.group ?? state.selectedGroup;
  byId("settingKey").value = setting?.key ?? "";
  byId("settingValue").value = setting?.value ?? "";
  byId("settingValue").placeholder = setting?.isSecret ? "Leave blank to keep current value" : "Enter a value";
  byId("settingSecret").checked = Boolean(setting?.isSecret);
  byId("secretHint").hidden = !setting?.isSecret;
  byId("formError").hidden = true;
  byId("formEyebrow").textContent = setting ? "EDIT ENTRY" : "NEW ENTRY";
  byId("formTitle").textContent = setting ? "Edit setting" : "Add a setting";
  byId("saveSettingButton").textContent = setting ? "Save changes" : "Save setting";
  byId("settingDialog").showModal();
  byId("settingGroup").focus();
}

function updateExportExample() {
  const group = byId("exportGroup").value;
  const url = new URL("/api/settings/export", window.location.origin);
  if (group) url.searchParams.set("group", group);
  byId("exportUrl").textContent = url.pathname + url.search;
  const auth = state.apiKey ? " -H 'X-Api-Key: <YOUR_API_KEY>'" : "";
  byId("curlSample").textContent = `curl '${url.href}'${auth} -H 'Accept: application/json'`;
}

async function downloadExport() {
  try {
    const group = byId("exportGroup").value;
    const query = group ? `?group=${encodeURIComponent(group)}` : "";
    const result = await api(`/api/settings/export${query}`);
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `keyledger-settings${group ? `-${group.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : ""}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  } catch (error) {
    if (error.message !== "Enter an API key to continue.") toast(error.message, true);
  }
}

document.addEventListener("click", async (event) => {
  const groupButton = event.target.closest("[data-group]");
  if (groupButton) {
    state.selectedGroup = groupButton.dataset.group;
    byId("groupFilter").value = state.selectedGroup;
    byId("allGroupsButton").classList.remove("is-active");
    renderGroups();
    renderSettings();
  }

  const editButton = event.target.closest("[data-edit]");
  if (editButton) {
    const setting = state.settings.find((item) => item.id === Number(editButton.dataset.edit));
    if (setting) openSetting(setting);
  }

  const deleteButton = event.target.closest("[data-delete]");
  if (deleteButton) {
    const setting = state.settings.find((item) => item.id === Number(deleteButton.dataset.delete));
    if (setting) {
      state.deleteId = setting.id;
      byId("deleteMessage").textContent = `${setting.group} / ${setting.key} will be permanently removed.`;
      byId("deleteDialog").showModal();
    }
  }

  const closeButton = event.target.closest("[data-close]");
  if (closeButton) byId(closeButton.dataset.close).close();
});

byId("allGroupsButton").addEventListener("click", () => {
  state.selectedGroup = "";
  byId("groupFilter").value = "";
  byId("allGroupsButton").classList.add("is-active");
  renderGroups();
  renderSettings();
});
byId("groupFilter").addEventListener("change", (event) => {
  state.selectedGroup = event.target.value;
  byId("allGroupsButton").classList.toggle("is-active", !state.selectedGroup);
  renderGroups();
  renderSettings();
});
byId("searchInput").addEventListener("input", (event) => {
  state.search = event.target.value;
  renderSettings();
});
byId("searchInput").addEventListener("keydown", (event) => {
  if (event.key === "Escape") event.currentTarget.value = "";
});
byId("refreshButton").addEventListener("click", loadData);
byId("addSettingButton").addEventListener("click", () => openSetting());
byId("newGroupButton").addEventListener("click", () => openSetting());
byId("emptyAddButton").addEventListener("click", () => openSetting());
byId("exportButton").addEventListener("click", () => {
  updateExportExample();
  byId("exportDialog").showModal();
});
byId("exportGroup").addEventListener("change", updateExportExample);
byId("downloadExportButton").addEventListener("click", downloadExport);
byId("copyUrlButton").addEventListener("click", async () => {
  await navigator.clipboard.writeText(new URL(byId("exportUrl").textContent, window.location.origin).href);
  toast("Endpoint copied to clipboard.");
});
byId("apiAccessButton").addEventListener("click", () => {
  byId("keyError").hidden = true;
  byId("keyDialog").showModal();
});
byId("settingSecret").addEventListener("change", (event) => {
  if (event.target.checked && !byId("settingValue").value) byId("settingValue").placeholder = "Enter a protected value";
});

byId("settingForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = byId("settingId").value;
  const payload = {
    group: byId("settingGroup").value,
    key: byId("settingKey").value,
    value: byId("settingValue").value,
    isSecret: byId("settingSecret").checked
  };
  try {
    await api(id ? `/api/settings/${id}` : "/api/settings", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(payload)
    });
    byId("settingDialog").close();
    toast(id ? "Setting updated." : "Setting created.");
    await loadData();
  } catch (error) {
    if (error.message === "Enter an API key to continue.") return;
    byId("formError").textContent = error.message;
    byId("formError").hidden = false;
  }
});

byId("confirmDeleteButton").addEventListener("click", async (event) => {
  event.preventDefault();
  if (state.deleteId === null) return;
  try {
    await api(`/api/settings/${state.deleteId}`, { method: "DELETE" });
    byId("deleteDialog").close();
    toast("Setting deleted.");
    state.deleteId = null;
    await loadData();
  } catch (error) {
    if (error.message !== "Enter an API key to continue.") toast(error.message, true);
  }
});

byId("keyForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  state.apiKey = byId("apiKeyInput").value;
  try {
    await api("/api/status");
    sessionStorage.setItem("keyledger-api-key", state.apiKey);
    byId("keyDialog").close();
    byId("apiKeyInput").value = "";
    state.keyPromptOpen = false;
    await loadData();
  } catch {
    state.apiKey = "";
    byId("keyError").textContent = "That key was not accepted.";
    byId("keyError").hidden = false;
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
    event.preventDefault();
    byId("searchInput").focus();
  }
});

loadData();