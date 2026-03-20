import { Bot, InlineKeyboard } from "grammy";
import { chunkText, formatDateTime } from "./utils.js";

function buildMainMenuKeyboard() {
  return new InlineKeyboard()
    .text("New Chat", "menu:newchat")
    .text("Settings", "menu:settings")
    .row()
    .text("My Info", "menu:me")
    .text("Privacy", "menu:privacy")
    .row()
    .text("Help", "menu:help");
}

function buildWelcomeMessage(appName, session) {
  return [
    `Welcome to ${appName}`,
    "",
    "You can chat naturally and I will forward your messages to the connected Flowise AI.",
    "",
    `Active session: <code>${session.sessionKey}</code>`,
    "",
    "Quick actions are below, or just send a message to start chatting."
  ].join("\n");
}

function buildHelpMessage() {
  return [
    "Here is what you can do:",
    "",
    "/start - show the welcome screen",
    "/help - show this help message",
    "/settings - change language and response style",
    "/newchat - start a fresh Flowise session",
    "/me - view your stored Telegram profile info",
    "/privacy - see what is stored locally",
    "",
    "Tip: you can also use the inline buttons instead of typing commands."
  ].join("\n");
}

function buildPrivacyMessage() {
  return [
    "Privacy summary",
    "",
    "Stored locally:",
    "- Telegram user ID",
    "- username and public name",
    "- first/last name",
    "- language code",
    "- chat ID and chat type",
    "- first seen / last seen",
    "- settings, session keys, counts, rate-limit counters",
    "",
    "Not stored locally:",
    "- chat transcripts",
    "",
    "Chat history is fetched live from Flowise for the dashboard."
  ].join("\n");
}

function buildSettingsKeyboard(settings) {
  return new InlineKeyboard()
    .text(`Language: ${settings.preferredLanguage}`, "noop")
    .row()
    .text("Auto", "setting:lang:auto")
    .text("English", "setting:lang:english")
    .text("Hindi", "setting:lang:hindi")
    .row()
    .text(`Style: ${settings.responseStyle}`, "noop")
    .row()
    .text("Standard", "setting:style:standard")
    .text("Concise", "setting:style:concise")
    .text("Friendly", "setting:style:friendly")
    .row()
    .text(`Rate alerts: ${settings.rateLimitAlerts ? "on" : "off"}`, "noop")
    .row()
    .text("Alerts on", "setting:alerts:on")
    .text("Alerts off", "setting:alerts:off");
}

function buildSettingsMessage(settings) {
  return [
    "Your current settings:",
    `- preferred language: ${settings.preferredLanguage}`,
    `- response style: ${settings.responseStyle}`,
    `- rate-limit alerts: ${settings.rateLimitAlerts ? "on" : "off"}`,
    "",
    "Choose an option below to update it."
  ].join("\n");
}

function buildProfileMessage(user, activeSession) {
  return [
    "Known Telegram info:",
    `- user id: ${user.telegramUserId}`,
    `- username: ${user.username || "n/a"}`,
    `- public name: ${user.publicName}`,
    `- first name: ${user.firstName || "n/a"}`,
    `- last name: ${user.lastName || "n/a"}`,
    `- language code: ${user.languageCode || "n/a"}`,
    `- chat id: ${user.chatId || "n/a"}`,
    `- chat type: ${user.chatType || "n/a"}`,
    `- first seen: ${formatDateTime(user.firstSeenAt)}`,
    `- last seen: ${formatDateTime(user.lastSeenAt)}`,
    `- active session: ${activeSession?.sessionKey || "n/a"}`,
    `- total AI replies: ${user.totalAiMessages || 0}`
  ].join("\n");
}

function buildNewChatMessage(session) {
  return [
    "Started a fresh Flowise session.",
    "",
    `New session: <code>${session.sessionKey}</code>`,
    "",
    "Your next messages will go to this new chat."
  ].join("\n");
}

function buildRateLimitMessage(rate) {
  return [
    "Rate limit reached for now.",
    "",
    `Allowed: ${rate.limit} AI messages every 6 hours`,
    `Try again after: ${formatDateTime(rate.resetAt)}`
  ].join("\n");
}

function buildFlowiseErrorMessage(error) {
  return [
    "I could not reach the Flowise AI right now.",
    "",
    `Reason: ${error.message}`,
    "",
    "Please try again in a moment."
  ].join("\n");
}

async function replyInChunks(ctx, text, extra = {}) {
  for (const chunk of chunkText(text)) {
    await ctx.reply(chunk, extra);
  }
}

async function respondWithMenu(ctx, text, extra = {}) {
  await replyInChunks(ctx, text, {
    parse_mode: "HTML",
    reply_markup: buildMainMenuKeyboard(),
    ...extra
  });
}

async function ensureUserContext(ctx, store) {
  const user = await store.upsertTelegramUser(ctx.from, ctx.chat);
  const session = await store.ensureDefaultSession(user.telegramUserId);
  return { user, session };
}

function isPrivateOrAllowed(ctx, config) {
  return ctx.chat?.type === "private" || config.allowGroupChats;
}

export function createTelegramBot({ config, store, flowise, rateLimiter }) {
  const bot = new Bot(config.telegramBotToken);

  bot.catch((error) => {
    console.error("Telegram bot error:", error.error);
  });

  bot.command("start", async (ctx) => {
    if (!isPrivateOrAllowed(ctx, config)) {
      return;
    }

    const { user, session } = await ensureUserContext(ctx, store);
    await store.incrementCommand(user.telegramUserId, "/start");
    await respondWithMenu(ctx, buildWelcomeMessage(config.appName, session));
  });

  bot.command("help", async (ctx) => {
    if (!isPrivateOrAllowed(ctx, config)) {
      return;
    }

    const { user } = await ensureUserContext(ctx, store);
    await store.incrementCommand(user.telegramUserId, "/help");
    await respondWithMenu(ctx, buildHelpMessage());
  });

  bot.command("privacy", async (ctx) => {
    if (!isPrivateOrAllowed(ctx, config)) {
      return;
    }

    const { user } = await ensureUserContext(ctx, store);
    await store.incrementCommand(user.telegramUserId, "/privacy");
    await respondWithMenu(ctx, buildPrivacyMessage());
  });

  bot.command("settings", async (ctx) => {
    if (!isPrivateOrAllowed(ctx, config)) {
      return;
    }

    const { user } = await ensureUserContext(ctx, store);
    await store.incrementCommand(user.telegramUserId, "/settings");
    await ctx.reply(buildSettingsMessage(user.settings), {
      parse_mode: "HTML",
      reply_markup: buildSettingsKeyboard(user.settings)
    });
  });

  bot.command("me", async (ctx) => {
    if (!isPrivateOrAllowed(ctx, config)) {
      return;
    }

    const { user, session } = await ensureUserContext(ctx, store);
    await store.incrementCommand(user.telegramUserId, "/me");
    await respondWithMenu(ctx, buildProfileMessage(user, session));
  });

  bot.command("newchat", async (ctx) => {
    if (!isPrivateOrAllowed(ctx, config)) {
      return;
    }

    const { user } = await ensureUserContext(ctx, store);
    await store.incrementCommand(user.telegramUserId, "/newchat");
    const session = await store.createNewSession(user.telegramUserId);
    await respondWithMenu(ctx, buildNewChatMessage(session));
  });

  bot.callbackQuery("noop", async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^menu:(help|settings|newchat|me|privacy)$/, async (ctx) => {
    if (!isPrivateOrAllowed(ctx, config)) {
      await ctx.answerCallbackQuery();
      return;
    }

    const action = ctx.match[1];
    const { user, session } = await ensureUserContext(ctx, store);

    if (action === "help") {
      await ctx.reply(buildHelpMessage(), {
        parse_mode: "HTML",
        reply_markup: buildMainMenuKeyboard()
      });
      await ctx.answerCallbackQuery("Opened help");
      return;
    }

    if (action === "settings") {
      await ctx.reply(buildSettingsMessage(user.settings), {
        parse_mode: "HTML",
        reply_markup: buildSettingsKeyboard(user.settings)
      });
      await ctx.answerCallbackQuery("Opened settings");
      return;
    }

    if (action === "newchat") {
      const newSession = await store.createNewSession(user.telegramUserId);
      await ctx.reply(buildNewChatMessage(newSession), {
        parse_mode: "HTML",
        reply_markup: buildMainMenuKeyboard()
      });
      await ctx.answerCallbackQuery("Started new chat");
      return;
    }

    if (action === "me") {
      await ctx.reply(buildProfileMessage(user, session), {
        parse_mode: "HTML",
        reply_markup: buildMainMenuKeyboard()
      });
      await ctx.answerCallbackQuery("Opened your info");
      return;
    }

    await ctx.reply(buildPrivacyMessage(), {
      parse_mode: "HTML",
      reply_markup: buildMainMenuKeyboard()
    });
    await ctx.answerCallbackQuery("Opened privacy");
  });

  bot.callbackQuery(/^setting:(lang|style|alerts):(.+)$/, async (ctx) => {
    if (!isPrivateOrAllowed(ctx, config)) {
      await ctx.answerCallbackQuery();
      return;
    }

    const { user } = await ensureUserContext(ctx, store);
    const [, group, value] = ctx.match;

    const updates =
      group === "lang"
        ? { preferredLanguage: value }
        : group === "style"
          ? { responseStyle: value }
          : { rateLimitAlerts: value === "on" };

    const settings = await store.updateUserSettings(user.telegramUserId, updates);
    await ctx.editMessageText(buildSettingsMessage(settings), {
      parse_mode: "HTML",
      reply_markup: buildSettingsKeyboard(settings)
    });
    await ctx.answerCallbackQuery("Updated");
  });

  bot.on("message:text", async (ctx) => {
    if (!isPrivateOrAllowed(ctx, config)) {
      return;
    }

    const incomingText = ctx.message.text?.trim();
    if (!incomingText || incomingText.startsWith("/")) {
      return;
    }

    const { user, session } = await ensureUserContext(ctx, store);
    const rate = await rateLimiter.consume(user.telegramUserId);

    if (!rate.allowed) {
      if (user.settings.rateLimitAlerts) {
        await respondWithMenu(ctx, buildRateLimitMessage(rate));
      }
      return;
    }

    await store.touchSession(user.telegramUserId, session.sessionKey);
    await ctx.api.sendChatAction(ctx.chat.id, "typing");

    try {
      const response = await flowise.sendMessage({
        sessionKey: session.sessionKey,
        question: incomingText,
        settings: user.settings
      });

      await store.incrementAiMessages(user.telegramUserId);
      await replyInChunks(ctx, response.text);
    } catch (error) {
      await store.markFlowiseError(user.telegramUserId);
      await respondWithMenu(ctx, buildFlowiseErrorMessage(error));
    }
  });

  return bot;
}
