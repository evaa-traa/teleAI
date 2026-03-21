function buildHeaders(apiKey) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json"
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return headers;
}

function debugLog(config, event, data = {}) {
  if (!config.debugLogs) {
    return;
  }

  console.log(`[flowise] ${event}`, data);
}

function withTimeout(timeoutMs) {
  if (!timeoutMs || timeoutMs <= 0) {
    return {
      signal: undefined,
      done() {}
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    done() {
      clearTimeout(timeout);
    }
  };
}

function decorateQuestion(question, settings) {
  const instructions = [];

  if (settings?.preferredLanguage === "english") {
    instructions.push("Reply in English.");
  }

  if (settings?.preferredLanguage === "hindi") {
    instructions.push("Reply in Hindi.");
  }

  if (settings?.responseStyle === "concise") {
    instructions.push("Keep the reply concise.");
  }

  if (settings?.responseStyle === "friendly") {
    instructions.push("Use a friendly tone.");
  }

  if (instructions.length === 0) {
    return question;
  }

  return `[User preference: ${instructions.join(" ")}]\n\n${question}`;
}

function extractReply(payload) {
  if (!payload) {
    return "Flowise returned an empty response.";
  }

  if (typeof payload === "string") {
    return payload;
  }

  if (typeof payload.text === "string" && payload.text.trim()) {
    return payload.text;
  }

  if (typeof payload.answer === "string" && payload.answer.trim()) {
    return payload.answer;
  }

  if (typeof payload.result === "string" && payload.result.trim()) {
    return payload.result;
  }

  if (typeof payload.response === "string" && payload.response.trim()) {
    return payload.response;
  }

  return JSON.stringify(payload, null, 2);
}

export function createFlowiseClient(config) {
  const headers = buildHeaders(config.flowiseApiKey);

  return {
    async sendMessage({ session, question, settings }) {
      const timeout = withTimeout(config.flowiseTimeoutMs);
      const chatId = session.flowiseChatId || session.sessionKey;
      const body = {
        question: decorateQuestion(question, settings)
      };

      if (config.flowiseSessionMode === "chatId") {
        body.chatId = chatId;
      } else {
        body.overrideConfig = {
          sessionId: session.sessionKey
        };
      }

      try {
        debugLog(config, "prediction.request", {
          url: `${config.flowiseBaseUrl}/api/v1/prediction/${config.flowiseFlowId}`,
          sessionMode: config.flowiseSessionMode,
          sessionKey: session.sessionKey,
          flowiseChatId: chatId,
          body
        });
        const response = await fetch(`${config.flowiseBaseUrl}/api/v1/prediction/${config.flowiseFlowId}`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: timeout.signal
        });

        const payload = await response.json().catch(() => null);
        debugLog(config, "prediction.response", {
          status: response.status,
          ok: response.ok,
          payload
        });

        if (!response.ok) {
          console.error("[flowise] prediction.failed", {
            url: `${config.flowiseBaseUrl}/api/v1/prediction/${config.flowiseFlowId}`,
            status: response.status,
            sessionMode: config.flowiseSessionMode,
            sessionKey: session.sessionKey,
            flowiseChatId: chatId,
            payload
          });
          if (response.status === 422 && !payload) {
            throw new Error(
              "Flowise prediction failed with 422. The flow rejected the request payload. Verify this flow accepts question-based Prediction API calls and allows the configured session mode."
            );
          }

          const message = payload?.message || payload?.error || response.statusText;
          throw new Error(`Flowise prediction failed: ${message}`);
        }

        return {
          raw: payload,
          text: extractReply(payload)
        };
      } catch (error) {
        console.error("[flowise] prediction.exception", {
          url: `${config.flowiseBaseUrl}/api/v1/prediction/${config.flowiseFlowId}`,
          sessionMode: config.flowiseSessionMode,
          sessionKey: session.sessionKey,
          flowiseChatId: chatId,
          message: error?.message || String(error)
        });
        if (error?.name === "AbortError") {
          const timeoutSeconds = config.flowiseTimeoutMs > 0 ? Math.round(config.flowiseTimeoutMs / 1000) : null;
          throw new Error(
            timeoutSeconds
              ? `Flowise request timed out after ${timeoutSeconds} seconds`
              : "Flowise request timed out"
          );
        }

        throw error;
      } finally {
        timeout.done();
      }
    },

    async getMessages(session) {
      const timeout = withTimeout(config.flowiseTimeoutMs);
      const params = new URLSearchParams({
        order: "ASC"
      });

      if (config.flowiseSessionMode === "chatId") {
        params.set("chatId", session.flowiseChatId || session.sessionKey);
      } else {
        params.set("sessionId", session.sessionKey);
      }

      try {
        debugLog(config, "history.request", {
          url: `${config.flowiseBaseUrl}/api/v1/chatmessage/${config.flowiseFlowId}?${params.toString()}`,
          sessionMode: config.flowiseSessionMode,
          sessionKey: session.sessionKey,
          flowiseChatId: session.flowiseChatId || session.sessionKey
        });
        const response = await fetch(
          `${config.flowiseBaseUrl}/api/v1/chatmessage/${config.flowiseFlowId}?${params.toString()}`,
          {
            method: "GET",
            headers,
            signal: timeout.signal
          }
        );

        const payload = await response.json().catch(() => []);
        debugLog(config, "history.response", {
          status: response.status,
          ok: response.ok,
          count: Array.isArray(payload) ? payload.length : null,
          payload: Array.isArray(payload) ? undefined : payload
        });

        if (!response.ok) {
          console.error("[flowise] history.failed", {
            url: `${config.flowiseBaseUrl}/api/v1/chatmessage/${config.flowiseFlowId}?${params.toString()}`,
            status: response.status,
            sessionMode: config.flowiseSessionMode,
            sessionKey: session.sessionKey,
            flowiseChatId: session.flowiseChatId || session.sessionKey,
            payload
          });
          const message = payload?.message || payload?.error || response.statusText;
          throw new Error(`Flowise chat history failed: ${message}`);
        }

        return Array.isArray(payload)
          ? payload.map((message) => ({
              id: message.id,
              role: message.role,
              content: message.content,
              createdDate: message.createdDate || message.createdAt || null,
              sessionId: message.sessionId || null,
              chatId: message.chatId || null,
              memoryType: message.memoryType || null
            }))
          : [];
      } catch (error) {
        console.error("[flowise] history.exception", {
          url: `${config.flowiseBaseUrl}/api/v1/chatmessage/${config.flowiseFlowId}?${params.toString()}`,
          sessionMode: config.flowiseSessionMode,
          sessionKey: session.sessionKey,
          flowiseChatId: session.flowiseChatId || session.sessionKey,
          message: error?.message || String(error)
        });
        if (error?.name === "AbortError") {
          const timeoutSeconds = config.flowiseTimeoutMs > 0 ? Math.round(config.flowiseTimeoutMs / 1000) : null;
          throw new Error(
            timeoutSeconds
              ? `Flowise history request timed out after ${timeoutSeconds} seconds`
              : "Flowise history request timed out"
          );
        }

        throw error;
      } finally {
        timeout.done();
      }
    }
  };
}
