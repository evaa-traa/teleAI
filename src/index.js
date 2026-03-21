import path from "node:path";
import express from "express";
import { config, validateConfig } from "./config.js";
import { JsonStore } from "./store.js";
import { createFlowiseClient } from "./flowiseClient.js";
import { createRateLimiter } from "./rateLimiter.js";
import { createTelegramBot } from "./bot.js";
import { createAdminRouter } from "./adminRoutes.js";
import { createNeonBackupService } from "./neonBackup.js";

validateConfig();

const store = new JsonStore(config.dataFile);
await store.load();

const flowise = createFlowiseClient(config);
const rateLimiter = createRateLimiter({
  store,
  limit: config.messagesPer6Hours,
  windowMs: config.rateLimitWindowMs
});
const neonBackup = createNeonBackupService({ config, store });

if (neonBackup.enabled) {
  const restored = await neonBackup.restoreLatest();
  console.log("Neon restore:", restored);
}

const bot = createTelegramBot({ config, store, flowise, rateLimiter });
const telegramMode =
  config.telegramMode === "auto" ? (config.appBaseUrl ? "webhook" : "polling") : config.telegramMode;

const app = express();
app.use(express.json());
app.use(express.static(path.resolve(process.cwd(), "public")));

app.post(config.telegramWebhookPath, async (request, response) => {
  if (telegramMode !== "webhook") {
    response.status(404).json({ error: "Webhook mode disabled" });
    return;
  }

  if (config.telegramWebhookSecret) {
    const suppliedSecret = request.headers["x-telegram-bot-api-secret-token"];
    if (suppliedSecret !== config.telegramWebhookSecret) {
      response.status(401).json({ error: "Invalid webhook secret" });
      return;
    }
  }

  response.sendStatus(200);
  void bot.handleUpdate(request.body).catch((error) => {
    console.error("Telegram webhook handling failed:", error);
  });
});

app.get("/api/health", (request, response) => {
  response.json({
    ok: true,
    appName: config.appName,
    flowiseSessionMode: config.flowiseSessionMode
  });
});

app.use("/api/admin", createAdminRouter({ config, store, flowise, neonBackup }));

const server = app.listen(config.port, () => {
  console.log(`${config.appName} dashboard is running on http://localhost:${config.port}`);
  console.log(`Telegram startup mode: ${telegramMode}`);
});

const stopNeonBackupScheduler = neonBackup.startScheduler();
let telegramRetryTimer = null;
let isShuttingDown = false;

await bot.api.setMyCommands([
  { command: "start", description: "Show welcome menu" },
  { command: "help", description: "Show help" },
  { command: "settings", description: "Open settings" },
  { command: "newchat", description: "Start a new chat" }
]);

function isTelegramConflictError(error) {
  return error?.error_code === 409 || error?.description?.includes("other getUpdates request");
}

async function prepareTelegramWebhook() {
  if (!config.appBaseUrl) {
    throw new Error("APP_BASE_URL or RENDER_EXTERNAL_URL is required for Telegram webhook mode");
  }

  const webhookUrl = `${config.appBaseUrl}${config.telegramWebhookPath}`;
  await bot.api.setWebhook(webhookUrl, {
    drop_pending_updates: config.telegramDropPendingUpdates,
    secret_token: config.telegramWebhookSecret || undefined
  });
  console.log(`Telegram webhook configured at ${webhookUrl}`);
  console.log("Telegram webhook info:", await bot.api.getWebhookInfo());
}

async function prepareTelegramPolling() {
  if (!config.telegramDeleteWebhookOnStart) {
    return;
  }

  try {
    await bot.api.deleteWebhook({
      drop_pending_updates: config.telegramDropPendingUpdates
    });
  } catch (error) {
    console.error("Failed to clear Telegram webhook before polling:", error.message);
  }
}

function scheduleTelegramRetry() {
  if (isShuttingDown || telegramRetryTimer) {
    return;
  }

  telegramRetryTimer = setTimeout(() => {
    telegramRetryTimer = null;
    void startTelegramBot();
  }, config.telegramPollRetryMs);

  if (typeof telegramRetryTimer.unref === "function") {
    telegramRetryTimer.unref();
  }
}

async function startTelegramBot() {
  if (isShuttingDown) {
    return;
  }

  if (telegramMode === "webhook") {
    try {
      await prepareTelegramWebhook();
      console.log("Telegram bot is running in webhook mode.");
    } catch (error) {
      console.error("Failed to start Telegram webhook mode:", error);
      scheduleTelegramRetry();
    }
    return;
  }

  await prepareTelegramPolling();

  try {
    await bot.start({
      drop_pending_updates: config.telegramDropPendingUpdates
    });
  } catch (error) {
    if (isTelegramConflictError(error)) {
      console.error(
        `Telegram polling conflict detected. Retrying in ${config.telegramPollRetryMs}ms.`
      );
      scheduleTelegramRetry();
      return;
    }

    console.error("Failed to start Telegram bot:", error);
    scheduleTelegramRetry();
  }
}

void startTelegramBot();

async function shutdown(signal) {
  console.log(`Received ${signal}, shutting down...`);
  isShuttingDown = true;
  if (telegramRetryTimer) {
    clearTimeout(telegramRetryTimer);
    telegramRetryTimer = null;
  }
  stopNeonBackupScheduler();
  if (neonBackup.enabled) {
    try {
      await neonBackup.backupNow("shutdown");
    } catch (error) {
      console.error("Final Neon backup failed:", error.message);
    }
  }
  bot.stop();
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
