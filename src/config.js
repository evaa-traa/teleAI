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

export const config = {
  appName: process.env.APP_NAME || "TeleAI Bridge",
  port: toNumber(process.env.PORT, 3001),
  dataFile: path.resolve(process.cwd(), process.env.DATA_FILE || "./data/store.json"),
  adminToken: process.env.ADMIN_TOKEN || "",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
  allowGroupChats: toBoolean(process.env.ALLOW_GROUP_CHATS, false),
  flowiseBaseUrl: trimTrailingSlash(process.env.FLOWISE_BASE_URL || ""),
  flowiseFlowId: process.env.FLOWISE_FLOW_ID || "",
  flowiseApiKey: process.env.FLOWISE_API_KEY || "",
  flowiseSessionMode: process.env.FLOWISE_SESSION_MODE === "chatId" ? "chatId" : "sessionId",
  flowiseTimeoutMs: toNumber(process.env.FLOWISE_TIMEOUT_MS, 60_000),
  messagesPer6Hours: Math.max(1, toNumber(process.env.MESSAGES_PER_6_HOURS, 100)),
  rateLimitWindowMs: 6 * 60 * 60 * 1000,
  neonDatabaseUrl: process.env.NEON_DATABASE_URL || "",
  neonBackupKey: process.env.NEON_BACKUP_KEY || "teleai-primary",
  backupIntervalMinutes: Math.max(1, toNumber(process.env.BACKUP_INTERVAL_MINUTES, 30))
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
