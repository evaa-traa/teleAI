const elements = {
  adminToken: document.getElementById("adminToken"),
  saveToken: document.getElementById("saveToken"),
  refreshAll: document.getElementById("refreshAll"),
  refreshBackups: document.getElementById("refreshBackups"),
  triggerBackup: document.getElementById("triggerBackup"),
  summary: document.getElementById("summary"),
  backupActions: document.getElementById("backupActions"),
  backupMeta: document.getElementById("backupMeta"),
  backupData: document.getElementById("backupData"),
  usersTable: document.getElementById("usersTable"),
  userDetail: document.getElementById("userDetail"),
  messages: document.getElementById("messages"),
  newSessionBtn: document.getElementById("newSessionBtn"),
  refreshMessagesBtn: document.getElementById("refreshMessagesBtn")
};

const state = {
  token: localStorage.getItem("adminToken") || "",
  users: [],
  backups: [],
  selectedUserId: null,
  selectedSessionKey: null
};

if (state.token) {
  elements.adminToken.value = state.token;
}

function normalizeToken(value) {
  const text = String(value || "").trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }

  return text;
}

function formatDate(value) {
  if (!value) {
    return "n/a";
  }

  return new Date(value).toLocaleString();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-admin-token": state.token,
      ...(options.headers || {})
    }
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }

  return payload;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderSummary(data) {
  const cards = [
    ["Users", data.summary.totalUsers],
    ["Sessions", data.summary.totalSessions],
    ["Commands", data.summary.totalCommands],
    ["AI Msgs", data.summary.totalAiMessages],
    ["Limit / 6h", data.messagesPer6Hours],
    ["Mode", data.flowiseSessionMode],
    ["Neon", data.neonBackupEnabled ? "on" : "off"]
  ];

  elements.summary.innerHTML = cards
    .map(
      ([label, value]) => `
        <div class="summary-card">
          <div class="label">${label}</div>
          <div class="value">${value}</div>
        </div>
      `
    )
    .join("");
}

function renderBackupActions(backups) {
  state.backups = backups;

  const buttons = [
    '<button data-backup-source="live">View Live Data</button>',
    backups[0] ? `<button data-backup-id="${backups[0].snapshotId}">View Latest Backup</button>` : "",
    backups[1] ? `<button data-backup-id="${backups[1].snapshotId}">View Previous Backup</button>` : ""
  ]
    .filter(Boolean)
    .join("");

  elements.backupActions.innerHTML = buttons || '<div class="muted">No backups available yet.</div>';

  for (const button of elements.backupActions.querySelectorAll("button[data-backup-source='live']")) {
    button.addEventListener("click", () => {
      loadLiveSnapshot();
    });
  }

  for (const button of elements.backupActions.querySelectorAll("button[data-backup-id]")) {
    button.addEventListener("click", () => {
      loadBackupSnapshot(button.dataset.backupId);
    });
  }
}

function renderBackupSnapshot(label, payload) {
  elements.backupMeta.textContent = label;
  elements.backupData.textContent = JSON.stringify(payload, null, 2);
}

function renderUsers(users) {
  state.users = users;

  elements.usersTable.innerHTML = users
    .map(
      (user) => `
        <tr class="clickable" data-user-id="${user.telegramUserId}">
          <td>${user.publicName}</td>
          <td>${user.username ? `@${user.username}` : '<span class="muted">n/a</span>'}</td>
          <td>${user.sessionCount}</td>
          <td>${user.totalAiMessages || 0}</td>
          <td>${formatDate(user.lastSeenAt)}</td>
        </tr>
      `
    )
    .join("");

  for (const row of elements.usersTable.querySelectorAll("tr[data-user-id]")) {
    row.addEventListener("click", () => {
      selectUser(row.dataset.userId);
    });
  }
}

function renderUserDetail(detail) {
  const cards = [
    ["User ID", detail.telegramUserId],
    ["Username", detail.username ? `@${detail.username}` : "n/a"],
    ["Public Name", detail.publicName],
    ["Language", detail.languageCode || "n/a"],
    ["Chat Type", detail.chatType || "n/a"],
    ["Chat ID", detail.chatId || "n/a"],
    ["First Seen", formatDate(detail.firstSeenAt)],
    ["Last Seen", formatDate(detail.lastSeenAt)],
    ["AI Messages", detail.totalAiMessages || 0],
    ["Commands", detail.totalCommands || 0],
    ["Active Session", detail.activeSessionKey || "n/a"],
    ["Rate Limited", detail.lastRateLimitedAt ? formatDate(detail.lastRateLimitedAt) : "never"]
  ];

  const sessionChips = detail.sessions
    .map(
      (session) => `
        <button
          class="session-chip ${session.sessionKey === detail.activeSessionKey ? "active" : ""}"
          data-session-key="${session.sessionKey}"
        >
          ${session.label}
        </button>
      `
    )
    .join("");

  const commandItems =
    detail.recentCommands.length > 0
      ? detail.recentCommands
          .map(
            (item) => `
              <div class="command-item">
                <div>${item.command}</div>
                <div class="muted">${formatDate(item.createdAt)}</div>
              </div>
            `
          )
          .join("")
      : '<div class="muted">No recent commands.</div>';

  elements.userDetail.innerHTML = `
    <div class="detail-grid">
      ${cards
        .map(
          ([key, value]) => `
            <div class="detail-card">
              <div class="key">${key}</div>
              <div class="value">${value}</div>
            </div>
          `
        )
        .join("")}
    </div>
    <div class="session-list">${sessionChips}</div>
    <div class="command-list">${commandItems}</div>
  `;

  for (const button of elements.userDetail.querySelectorAll(".session-chip")) {
    button.addEventListener("click", () => {
      state.selectedSessionKey = button.dataset.sessionKey;
      loadMessages();
    });
  }

  elements.newSessionBtn.disabled = false;
  elements.refreshMessagesBtn.disabled = false;
}

function renderMessages(sessionKey, messages) {
  if (!messages.length) {
    elements.messages.innerHTML = `<div class="empty-state">No messages found for <code>${sessionKey}</code>.</div>`;
    return;
  }

  elements.messages.innerHTML = messages
    .map(
      (message) => `
        <div class="message">
          <div class="meta">${message.role} | ${formatDate(message.createdDate)} | ${message.memoryType || "n/a"}</div>
          <pre>${escapeHtml(message.content || "")}</pre>
        </div>
      `
    )
    .join("");
}

async function loadSummaryAndUsers() {
  const [summaryData, usersData] = await Promise.all([api("/api/admin/summary"), api("/api/admin/users")]);
  renderSummary(summaryData);
  renderUsers(usersData.users);
}

async function loadBackups() {
  const payload = await api("/api/admin/backups");
  renderBackupActions(payload.backups || []);
}

async function triggerBackup() {
  const originalText = elements.triggerBackup.textContent;
  elements.triggerBackup.disabled = true;
  elements.triggerBackup.textContent = "Running...";

  try {
    const payload = await api("/api/admin/backups/trigger", {
      method: "POST"
    });
    renderBackupActions(payload.backups || []);
    elements.backupMeta.textContent = `Manual backup completed at ${formatDate(payload.result.syncedAt)}`;
  } finally {
    elements.triggerBackup.disabled = false;
    elements.triggerBackup.textContent = originalText;
  }
}

async function loadLiveSnapshot() {
  elements.backupMeta.textContent = "Loading live local data...";
  const payload = await api("/api/admin/backups/live");
  renderBackupSnapshot("Viewing live local state", payload.snapshot);
}

async function loadBackupSnapshot(snapshotId) {
  elements.backupMeta.textContent = "Loading backup snapshot...";
  const payload = await api(`/api/admin/backups/${snapshotId}`);
  const label = `Viewing ${payload.snapshotId === state.backups[0]?.snapshotId ? "latest" : "previous"} backup • synced ${formatDate(payload.syncedAt)}`;
  renderBackupSnapshot(label, payload.snapshot);
}

async function selectUser(userId) {
  state.selectedUserId = userId;
  const detail = await api(`/api/admin/users/${userId}`);
  state.selectedSessionKey = detail.activeSessionKey || detail.sessions[0]?.sessionKey || null;
  renderUserDetail(detail);
  await loadMessages();
}

async function loadMessages() {
  if (!state.selectedUserId || !state.selectedSessionKey) {
    elements.messages.innerHTML = `<div class="empty-state">Select a session.</div>`;
    return;
  }

  elements.messages.innerHTML = `<div class="muted">Loading messages for <code>${state.selectedSessionKey}</code>...</div>`;

  try {
    const payload = await api(
      `/api/admin/users/${state.selectedUserId}/messages?sessionKey=${encodeURIComponent(state.selectedSessionKey)}`
    );
    renderMessages(payload.sessionKey, payload.messages);
  } catch (error) {
    elements.messages.innerHTML = `<div class="error">${error.message}</div>`;
  }
}

async function createSession() {
  if (!state.selectedUserId) {
    return;
  }

  await api(`/api/admin/users/${state.selectedUserId}/sessions`, { method: "POST" });
  await selectUser(state.selectedUserId);
}

async function unlockAndLoad() {
  state.token = normalizeToken(elements.adminToken.value);
  elements.adminToken.value = state.token;
  localStorage.setItem("adminToken", state.token);
  await Promise.all([loadSummaryAndUsers(), loadBackups()]);
}

elements.saveToken.addEventListener("click", () => {
  unlockAndLoad().catch((error) => {
    alert(error.message);
  });
});

elements.refreshAll.addEventListener("click", () => {
  Promise.all([loadSummaryAndUsers(), loadBackups()])
    .then(() => {
      if (state.selectedUserId) {
        return selectUser(state.selectedUserId);
      }
      return undefined;
    })
    .catch((error) => {
      alert(error.message);
    });
});

elements.refreshBackups.addEventListener("click", () => {
  loadBackups().catch((error) => {
    alert(error.message);
  });
});

elements.triggerBackup.addEventListener("click", () => {
  triggerBackup().catch((error) => {
    alert(error.message);
  });
});

elements.refreshMessagesBtn.addEventListener("click", () => {
  loadMessages().catch((error) => {
    alert(error.message);
  });
});

elements.newSessionBtn.addEventListener("click", () => {
  createSession().catch((error) => {
    alert(error.message);
  });
});

if (state.token) {
  unlockAndLoad().catch(() => {
    elements.summary.innerHTML = `<div class="error">Saved admin token failed. Enter it again.</div>`;
  });
}
