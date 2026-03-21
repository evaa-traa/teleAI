import fs from "node:fs/promises";
import path from "node:path";
import { buildFlowiseChatId, buildPublicName, buildSessionKey, buildSessionLabel } from "./utils.js";

const DEFAULT_SETTINGS = {
  preferredLanguage: "auto",
  responseStyle: "standard",
  rateLimitAlerts: true
};

function createEmptyState() {
  return {
    users: {},
    sessionsByUser: {},
    commandLogs: [],
    meta: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastNeonBackupAt: null,
      lastNeonBackupReason: null,
      lastNeonBackupErrorAt: null,
      lastNeonBackupError: null,
      lastNeonRestoreAt: null,
      lastNeonRestoreSourceUpdatedAt: null
    }
  };
}

export class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = createEmptyState();
    this.writeQueue = Promise.resolve();
  }

  async load() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      this.state = {
        ...createEmptyState(),
        ...parsed,
        users: parsed.users || {},
        sessionsByUser: parsed.sessionsByUser || {},
        commandLogs: parsed.commandLogs || []
      };
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }

      await this.persist();
    }
  }

  async persist() {
    this.state.meta.updatedAt = new Date().toISOString();
    const payload = JSON.stringify(this.state, null, 2);

    this.writeQueue = this.writeQueue.then(() => fs.writeFile(this.filePath, payload, "utf8"));
    await this.writeQueue;
  }

  async replaceState(snapshot) {
    const base = createEmptyState();
    this.state = {
      ...base,
      ...snapshot,
      users: snapshot?.users || {},
      sessionsByUser: snapshot?.sessionsByUser || {},
      commandLogs: snapshot?.commandLogs || [],
      meta: {
        ...base.meta,
        ...(snapshot?.meta || {})
      }
    };

    await this.persist();
    return this.state;
  }

  getUserById(userId) {
    return this.state.users[String(userId)] || null;
  }

  exportState() {
    return JSON.parse(JSON.stringify(this.state));
  }

  getStateUpdatedAt() {
    return this.state.meta?.updatedAt || null;
  }

  getUserSessions(userId) {
    return [...(this.state.sessionsByUser[String(userId)] || [])].sort((left, right) => {
      return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    });
  }

  getActiveSession(userId) {
    const user = this.getUserById(userId);
    if (!user?.activeSessionKey) {
      return null;
    }

    return this.getUserSessions(userId).find((session) => session.sessionKey === user.activeSessionKey) || null;
  }

  async upsertTelegramUser(from, chat) {
    const userId = String(from.id);
    const now = new Date().toISOString();
    const existing = this.state.users[userId] || {};
    const publicName = buildPublicName(from);

    this.state.users[userId] = {
      telegramUserId: userId,
      username: from.username ?? null,
      firstName: from.first_name ?? null,
      lastName: from.last_name ?? null,
      publicName,
      languageCode: from.language_code ?? existing.languageCode ?? null,
      isBot: Boolean(from.is_bot),
      isPremium: from.is_premium ?? existing.isPremium ?? null,
      addedToAttachmentMenu: from.added_to_attachment_menu ?? existing.addedToAttachmentMenu ?? null,
      allowsWriteToPm: from.allows_write_to_pm ?? existing.allowsWriteToPm ?? null,
      chatId: chat?.id ? String(chat.id) : existing.chatId ?? null,
      chatType: chat?.type ?? existing.chatType ?? null,
      chatTitle: chat?.title ?? existing.chatTitle ?? null,
      firstSeenAt: existing.firstSeenAt || now,
      lastSeenAt: now,
      totalAiMessages: existing.totalAiMessages || 0,
      totalCommands: existing.totalCommands || 0,
      activeSessionKey: existing.activeSessionKey || null,
      lastRateLimitedAt: existing.lastRateLimitedAt || null,
      lastFlowiseErrorAt: existing.lastFlowiseErrorAt || null,
      rateLimitWindow: Array.isArray(existing.rateLimitWindow) ? existing.rateLimitWindow : [],
      settings: {
        ...DEFAULT_SETTINGS,
        ...(existing.settings || {})
      }
    };

    await this.persist();
    return this.state.users[userId];
  }

  async ensureDefaultSession(userId) {
    const user = this.getUserById(userId);
    if (!user) {
      throw new Error(`Unknown user ${userId}`);
    }

    if (!this.state.sessionsByUser[userId]) {
      this.state.sessionsByUser[userId] = [];
    }

    if (this.state.sessionsByUser[userId].length === 0) {
      const session = {
        sessionIndex: 0,
        sessionKey: buildSessionKey(user, 0),
        flowiseChatId: buildFlowiseChatId(),
        label: buildSessionLabel(user, 0),
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString()
      };

      this.state.sessionsByUser[userId].push(session);
      this.state.users[userId].activeSessionKey = session.sessionKey;
      await this.persist();
      return session;
    }

    if (!this.state.users[userId].activeSessionKey) {
      this.state.users[userId].activeSessionKey = this.state.sessionsByUser[userId][0].sessionKey;
      await this.persist();
    }

    const activeSession = this.getActiveSession(userId) || this.state.sessionsByUser[userId][0];
    if (!activeSession.flowiseChatId) {
      activeSession.flowiseChatId = buildFlowiseChatId();
      await this.persist();
    }

    return activeSession;
  }

  async createNewSession(userId) {
    const user = this.getUserById(userId);
    if (!user) {
      throw new Error(`Unknown user ${userId}`);
    }

    const existingSessions = this.getUserSessions(userId);
    const nextIndex = existingSessions.reduce((maxValue, session) => Math.max(maxValue, session.sessionIndex), 0) + 1;
    const session = {
      sessionIndex: nextIndex,
      sessionKey: buildSessionKey(user, nextIndex),
      flowiseChatId: buildFlowiseChatId(),
      label: buildSessionLabel(user, nextIndex),
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString()
    };

    if (!this.state.sessionsByUser[userId]) {
      this.state.sessionsByUser[userId] = [];
    }

    this.state.sessionsByUser[userId].push(session);
    this.state.users[userId].activeSessionKey = session.sessionKey;
    await this.persist();
    return session;
  }

  async touchSession(userId, sessionKey) {
    const sessions = this.state.sessionsByUser[String(userId)] || [];
    const session = sessions.find((item) => item.sessionKey === sessionKey);
    if (!session) {
      return null;
    }

    session.lastUsedAt = new Date().toISOString();
    if (!session.flowiseChatId) {
      session.flowiseChatId = buildFlowiseChatId();
    }
    this.state.users[String(userId)].activeSessionKey = sessionKey;
    await this.persist();
    return session;
  }

  async incrementCommand(userId, command) {
    const user = this.state.users[String(userId)];
    if (!user) {
      return;
    }

    user.totalCommands += 1;
    this.state.commandLogs.push({
      userId: String(userId),
      command,
      createdAt: new Date().toISOString()
    });
    await this.persist();
  }

  async incrementAiMessages(userId) {
    const user = this.state.users[String(userId)];
    if (!user) {
      return;
    }

    user.totalAiMessages += 1;
    user.lastSeenAt = new Date().toISOString();
    await this.persist();
  }

  async updateUserSettings(userId, partialSettings) {
    const user = this.state.users[String(userId)];
    if (!user) {
      throw new Error(`Unknown user ${userId}`);
    }

    user.settings = {
      ...DEFAULT_SETTINGS,
      ...user.settings,
      ...partialSettings
    };

    await this.persist();
    return user.settings;
  }

  async setRateLimitWindow(userId, timestamps) {
    const user = this.state.users[String(userId)];
    if (!user) {
      throw new Error(`Unknown user ${userId}`);
    }

    user.rateLimitWindow = timestamps;
    await this.persist();
  }

  async markRateLimited(userId) {
    const user = this.state.users[String(userId)];
    if (!user) {
      return;
    }

    user.lastRateLimitedAt = new Date().toISOString();
    await this.persist();
  }

  async markFlowiseError(userId) {
    const user = this.state.users[String(userId)];
    if (!user) {
      return;
    }

    user.lastFlowiseErrorAt = new Date().toISOString();
    await this.persist();
  }

  async markNeonBackup({ syncedAt, reason }) {
    this.state.meta.lastNeonBackupAt = syncedAt;
    this.state.meta.lastNeonBackupReason = reason;
    this.state.meta.lastNeonBackupErrorAt = null;
    this.state.meta.lastNeonBackupError = null;
    await this.persist();
  }

  async markNeonBackupError(error) {
    this.state.meta.lastNeonBackupErrorAt = new Date().toISOString();
    this.state.meta.lastNeonBackupError = error;
    await this.persist();
  }

  async markNeonRestore(sourceUpdatedAt) {
    this.state.meta.lastNeonRestoreAt = new Date().toISOString();
    this.state.meta.lastNeonRestoreSourceUpdatedAt = sourceUpdatedAt || null;
    await this.persist();
  }

  getSummary() {
    const users = Object.values(this.state.users);
    const sessions = Object.values(this.state.sessionsByUser).flat();

    return {
      totalUsers: users.length,
      totalSessions: sessions.length,
      totalCommands: users.reduce((sum, user) => sum + (user.totalCommands || 0), 0),
      totalAiMessages: users.reduce((sum, user) => sum + (user.totalAiMessages || 0), 0),
      lastUpdatedAt: this.state.meta.updatedAt,
      lastNeonBackupAt: this.state.meta.lastNeonBackupAt,
      lastNeonRestoreAt: this.state.meta.lastNeonRestoreAt
    };
  }

  listUsers() {
    return Object.values(this.state.users)
      .map((user) => ({
        ...user,
        sessionCount: this.getUserSessions(user.telegramUserId).length
      }))
      .sort((left, right) => new Date(right.lastSeenAt).getTime() - new Date(left.lastSeenAt).getTime());
  }

  getUserDetail(userId) {
    const user = this.getUserById(userId);
    if (!user) {
      return null;
    }

    return {
      ...user,
      sessions: this.getUserSessions(userId),
      recentCommands: this.state.commandLogs
        .filter((item) => item.userId === String(userId))
        .slice(-10)
        .reverse()
    };
  }
}
