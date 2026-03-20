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

const app = express();
app.use(express.json());
app.use(express.static(path.resolve(process.cwd(), "public")));

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
});

const stopNeonBackupScheduler = neonBackup.startScheduler();

await bot.api.setMyCommands([
  { command: "start", description: "Start the bot" },
  { command: "help", description: "Show help" },
  { command: "settings", description: "Open settings" },
  { command: "newchat", description: "Start a fresh Flowise session" },
  { command: "me", description: "Show stored Telegram info" },
  { command: "privacy", description: "Show stored data policy" }
]);

bot.start().catch((error) => {
  console.error("Failed to start Telegram bot:", error);
  process.exit(1);
});

async function shutdown(signal) {
  console.log(`Received ${signal}, shutting down...`);
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
