import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

function toBoolean(value, fallback = false) {
  if (value === undefined) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function trimTrailingSlash(value) {
  return value ? value.replace(/\/+$/, "") : "";
}

function normalizeSecret(value) {
  const text = String(value || "").trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }

  return text;
}

function normalizePath(value, fallback) {
  const text = String(value || fallback || "").trim();
  if (!text) {
    return fallback;
  }

  return text.startsWith("/") ? text : `/${text}`;
}

function resolveAppBaseUrl() {
  const directValue = trimTrailingSlash(process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL || "");
  if (directValue) {
    return directValue;
  }

  const renderHostname = String(process.env.RENDER_EXTERNAL_HOSTNAME || "").trim();
  if (renderHostname) {
    return `https://${renderHostname.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  }

  return "";
}

export const config = {
  appName: process.env.APP_NAME || "TeleAI Bridge",
  port: toNumber(process.env.PORT, 3001),
  dataFile: path.resolve(process.cwd(), process.env.DATA_FILE || "./data/store.json"),
  adminToken: normalizeSecret(process.env.ADMIN_TOKEN),
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
  allowGroupChats: toBoolean(process.env.ALLOW_GROUP_CHATS, false),
  flowiseBaseUrl: trimTrailingSlash(process.env.FLOWISE_BASE_URL || ""),
  flowiseFlowId: process.env.FLOWISE_FLOW_ID || "",
  flowiseApiKey: process.env.FLOWISE_API_KEY || "",
  flowiseSessionMode: process.env.FLOWISE_SESSION_MODE === "chatId" ? "chatId" : "sessionId",
  flowiseTimeoutMs: Math.max(0, toNumber(process.env.FLOWISE_TIMEOUT_MS, 180_000)),
  messagesPer6Hours: Math.max(1, toNumber(process.env.MESSAGES_PER_6_HOURS, 100)),
  rateLimitWindowMs: 6 * 60 * 60 * 1000,
  neonDatabaseUrl: process.env.NEON_DATABASE_URL || "",
  neonBackupKey: process.env.NEON_BACKUP_KEY || "teleai-primary",
  backupIntervalMinutes: Math.max(1, toNumber(process.env.BACKUP_INTERVAL_MINUTES, 30)),
  telegramMode: ["auto", "polling", "webhook"].includes(process.env.TELEGRAM_MODE)
    ? process.env.TELEGRAM_MODE
    : "auto",
  debugLogs: toBoolean(process.env.DEBUG_LOGS, false),
  appBaseUrl: resolveAppBaseUrl(),
  telegramWebhookPath: normalizePath(process.env.TELEGRAM_WEBHOOK_PATH, "/webhooks/telegram"),
  telegramWebhookSecret: normalizeSecret(process.env.TELEGRAM_WEBHOOK_SECRET),
  telegramPollRetryMs: Math.max(5_000, toNumber(process.env.TELEGRAM_POLL_RETRY_MS, 15_000)),
  telegramDropPendingUpdates: toBoolean(process.env.TELEGRAM_DROP_PENDING_UPDATES, false),
  telegramDeleteWebhookOnStart: toBoolean(process.env.TELEGRAM_DELETE_WEBHOOK_ON_START, true)
};

export function validateConfig() {
  const missing = [];

  if (!config.adminToken) {
    missing.push("ADMIN_TOKEN");
  }

  if (!config.telegramBotToken) {
    missing.push("TELEGRAM_BOT_TOKEN");
  }

  if (!config.flowiseBaseUrl) {
    missing.push("FLOWISE_BASE_URL");
  }

  if (!config.flowiseFlowId) {
    missing.push("FLOWISE_FLOW_ID");
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}
