import { Bot, InlineKeyboard } from "grammy";
import { chunkText, formatDateTime, markdownToTelegramHtml } from "./utils.js";

function buildMainMenuKeyboard() {
  return new InlineKeyboard()
    .text("New Chat", "menu:newchat")
    .text("Settings", "menu:settings")
    .row()
    .text("Help", "menu:help");
}

function buildWelcomeMessage(appName, session) {
  void session;
  return [
    `Welcome to ${appName}`,
    "",
    "Send a message anytime to start chatting.",
    "",
    "Use the buttons below whenever you need them."
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
    "",
    "Tip: you can also use the inline buttons instead of typing commands."
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

function buildNewChatMessage(session) {
  void session;
  return [
    "Started a fresh Flowise session.",
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

function debugLog(config, event, data = {}) {
  if (!config.debugLogs) {
    return;
  }

  console.log(`[bot] ${event}`, data);
}

async function replyInChunks(ctx, text, extra = {}) {
  for (const chunk of chunkText(text)) {
    await ctx.reply(chunk, extra);
  }
}

async function sendFormattedChunk(ctx, text, editTarget) {
  const html = markdownToTelegramHtml(text);

  try {
    if (editTarget) {
      await ctx.api.editMessageText(ctx.chat.id, editTarget, html, { parse_mode: "HTML" });
    } else {
      await ctx.reply(html, { parse_mode: "HTML" });
    }
  } catch (htmlError) {
    // Log the error so we can diagnose HTML parsing issues
    console.warn("[bot] HTML formatting rejected by Telegram, falling back to plain text.", {
      error: htmlError?.message || String(htmlError),
      htmlPreview: html.slice(0, 200)
    });
    if (editTarget) {
      try {
        await ctx.api.editMessageText(ctx.chat.id, editTarget, text);
      } catch {
        await ctx.reply(text);
      }
    } else {
      await ctx.reply(text);
    }
  }
}

async function replacePlaceholderReply(ctx, placeholderMessage, text) {
  const chunks = chunkText(text);
  const [firstChunk = "I could not generate a response right now.", ...remainingChunks] = chunks;

  await sendFormattedChunk(ctx, firstChunk, placeholderMessage.message_id);

  for (const chunk of remainingChunks) {
    await sendFormattedChunk(ctx, chunk, null);
  }
}

async function respondWithMenu(ctx, text, extra = {}) {
  await replyInChunks(ctx, text, {
    parse_mode: "HTML",
    reply_markup: buildMainMenuKeyboard(),
    ...extra
  });
}

function startTypingLoop(ctx) {
  const chatId = ctx.chat?.id;
  if (!chatId) {
    return () => {};
  }

  let stopped = false;
  const send = async () => {
    try {
      await ctx.api.sendChatAction(chatId, "typing");
    } catch {
      // ignore
    }
  };

  void send();
  const interval = setInterval(() => {
    if (stopped) {
      return;
    }
    void send();
  }, 4000);

  if (typeof interval.unref === "function") {
    interval.unref();
  }

  return () => {
    stopped = true;
    clearInterval(interval);
  };
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
    debugLog(config, "command.start", {
      userId: user.telegramUserId,
      sessionKey: session.sessionKey,
      chatType: ctx.chat?.type
    });
    await store.incrementCommand(user.telegramUserId, "/start");
    await respondWithMenu(ctx, buildWelcomeMessage(config.appName, session));
  });

  bot.command("help", async (ctx) => {
    if (!isPrivateOrAllowed(ctx, config)) {
      return;
    }

    const { user } = await ensureUserContext(ctx, store);
    debugLog(config, "command.help", {
      userId: user.telegramUserId
    });
    await store.incrementCommand(user.telegramUserId, "/help");
    await respondWithMenu(ctx, buildHelpMessage());
  });

  bot.command("settings", async (ctx) => {
    if (!isPrivateOrAllowed(ctx, config)) {
      return;
    }

    const { user } = await ensureUserContext(ctx, store);
    debugLog(config, "command.settings", {
      userId: user.telegramUserId
    });
    await store.incrementCommand(user.telegramUserId, "/settings");
    await ctx.reply(buildSettingsMessage(user.settings), {
      parse_mode: "HTML",
      reply_markup: buildSettingsKeyboard(user.settings)
    });
  });

  bot.command("newchat", async (ctx) => {
    if (!isPrivateOrAllowed(ctx, config)) {
      return;
    }

    const { user } = await ensureUserContext(ctx, store);
    debugLog(config, "command.newchat", {
      userId: user.telegramUserId
    });
    await store.incrementCommand(user.telegramUserId, "/newchat");
    const session = await store.createNewSession(user.telegramUserId);
    await respondWithMenu(ctx, buildNewChatMessage(session));
  });

  bot.callbackQuery("noop", async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^menu:(help|settings|newchat)$/, async (ctx) => {
    if (!isPrivateOrAllowed(ctx, config)) {
      await ctx.answerCallbackQuery();
      return;
    }

    const action = ctx.match[1];
    const { user } = await ensureUserContext(ctx, store);
    debugLog(config, "menu.action", {
      userId: user.telegramUserId,
      action
    });

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
  });

  bot.callbackQuery(/^menu:/, async (ctx) => {
    await ctx.answerCallbackQuery("Menu updated. Send /start.");
  });

  bot.callbackQuery(/^setting:(lang|style|alerts):(.+)$/, async (ctx) => {
    if (!isPrivateOrAllowed(ctx, config)) {
      await ctx.answerCallbackQuery();
      return;
    }

    const { user } = await ensureUserContext(ctx, store);
    const [, group, value] = ctx.match;
    debugLog(config, "settings.update", {
      userId: user.telegramUserId,
      group,
      value
    });

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
    debugLog(config, "message.received", {
      userId: user.telegramUserId,
      sessionKey: session.sessionKey,
      flowiseChatId: session.flowiseChatId || null,
      textLength: incomingText.length,
      chatType: ctx.chat?.type
    });
    const rate = await rateLimiter.consume(user.telegramUserId);

    if (!rate.allowed) {
      debugLog(config, "message.rate_limited", {
        userId: user.telegramUserId,
        limit: rate.limit,
        resetAt: rate.resetAt
      });
      if (user.settings.rateLimitAlerts) {
        await respondWithMenu(ctx, buildRateLimitMessage(rate));
      }
      return;
    }

    await store.touchSession(user.telegramUserId, session.sessionKey);
    const placeholderMessage = await ctx.reply("Thinking...");
    const stopTyping = startTypingLoop(ctx);

    try {
      debugLog(config, "flowise.request.start", {
        userId: user.telegramUserId,
        sessionKey: session.sessionKey,
        flowiseChatId: session.flowiseChatId || null
      });
      const response = await flowise.sendMessage({
        session,
        question: incomingText,
        settings: user.settings
      });

      await store.incrementAiMessages(user.telegramUserId);
      debugLog(config, "flowise.request.success", {
        userId: user.telegramUserId,
        sessionKey: session.sessionKey,
        responseLength: String(response.text || "").length
      });
      await replacePlaceholderReply(ctx, placeholderMessage, response.text);
    } catch (error) {
      await store.markFlowiseError(user.telegramUserId);
      debugLog(config, "flowise.request.error", {
        userId: user.telegramUserId,
        sessionKey: session.sessionKey,
        message: error.message
      });
      await replacePlaceholderReply(ctx, placeholderMessage, buildFlowiseErrorMessage(error));
    } finally {
      stopTyping();
    }
  });

  return bot;
}
