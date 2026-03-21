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

  async function callPrediction({ body, sessionKey, chatId, signal }) {
    const url = `${config.flowiseBaseUrl}/api/v1/prediction/${config.flowiseFlowId}`;
    debugLog(config, "prediction.request", {
      url,
      sessionMode: config.flowiseSessionMode,
      sessionKey,
      flowiseChatId: chatId,
      body
    });

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal
    });

    const payload = await response.json().catch(() => null);
    debugLog(config, "prediction.response", {
      status: response.status,
      ok: response.ok,
      payload
    });

    return { response, payload };
  }

  return {
    async sendMessage({ session, question, settings }) {
      const timeout = withTimeout(config.flowiseTimeoutMs);
      const decoratedQuestion = decorateQuestion(question, settings);

      // Always set chatId to the session key so Flowise UI groups
      // messages under a recognizable name (e.g. "tg_7638676611")
      // instead of anonymous auto-generated UUIDs.
      const body = {
        question: decoratedQuestion,
        chatId: session.sessionKey
      };

      if (config.flowiseSessionMode === "chatId") {
        // chatId-only mode: no overrideConfig needed
      } else {
        body.overrideConfig = {
          sessionId: session.sessionKey
        };
      }

      try {
        let { response, payload } = await callPrediction({
          body,
          sessionKey: session.sessionKey,
          chatId: session.sessionKey,
          signal: timeout.signal
        });

        // --- 422 fallback: retry WITHOUT overrideConfig ---
        // Flowise may reject overrideConfig in two ways:
        //   1. Direct HTTP 422 (no body)
        //   2. HTTP 500 wrapping an internal 422 in payload.message
        // If either pattern is detected AND we sent overrideConfig,
        // retry without it — but KEEP chatId so Flowise UI still
        // groups the message under the correct session name.
        const is422Direct = response.status === 422;
        const is422Wrapped =
          response.status === 500 &&
          typeof payload?.message === "string" &&
          payload.message.includes("422");
        
        if ((is422Direct || is422Wrapped) && body.overrideConfig) {
          console.warn(
            "[flowise] Flowise rejected overrideConfig (status %d, inner 422). Retrying WITHOUT overrideConfig.",
            response.status,
            "To restore per-user session isolation, enable sessionId in",
            "your Flowise chatflow's Override Config settings."
          );
          const fallbackBody = {
            question: decoratedQuestion,
            chatId: session.sessionKey
          };
          ({ response, payload } = await callPrediction({
            body: fallbackBody,
            sessionKey: session.sessionKey,
            chatId: session.sessionKey,
            signal: timeout.signal
          }));
        }

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
              "Flowise prediction failed with 422. The flow rejected the request payload. " +
              "Verify the FLOWISE_FLOW_ID is correct and the chatflow accepts Prediction API calls."
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
        params.set("chatId", session.sessionKey);
      } else {
        params.set("sessionId", session.sessionKey);
      }

      try {
        debugLog(config, "history.request", {
          url: `${config.flowiseBaseUrl}/api/v1/chatmessage/${config.flowiseFlowId}?${params.toString()}`,
          sessionMode: config.flowiseSessionMode,
          sessionKey: session.sessionKey
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
