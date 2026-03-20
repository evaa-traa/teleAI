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

function withTimeout(timeoutMs) {
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
    async sendMessage({ sessionKey, question, settings }) {
      const timeout = withTimeout(config.flowiseTimeoutMs);
      const body = {
        question: decorateQuestion(question, settings)
      };

      if (config.flowiseSessionMode === "chatId") {
        body.chatId = sessionKey;
      } else {
        body.overrideConfig = {
          sessionId: sessionKey
        };
      }

      try {
        const response = await fetch(`${config.flowiseBaseUrl}/api/v1/prediction/${config.flowiseFlowId}`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: timeout.signal
        });

        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          const message = payload?.message || payload?.error || response.statusText;
          throw new Error(`Flowise prediction failed: ${message}`);
        }

        return {
          raw: payload,
          text: extractReply(payload)
        };
      } finally {
        timeout.done();
      }
    },

    async getMessages(sessionKey) {
      const timeout = withTimeout(config.flowiseTimeoutMs);
      const params = new URLSearchParams({
        order: "ASC"
      });

      if (config.flowiseSessionMode === "chatId") {
        params.set("chatId", sessionKey);
      } else {
        params.set("sessionId", sessionKey);
      }

      try {
        const response = await fetch(
          `${config.flowiseBaseUrl}/api/v1/chatmessage/${config.flowiseFlowId}?${params.toString()}`,
          {
            method: "GET",
            headers,
            signal: timeout.signal
          }
        );

        const payload = await response.json().catch(() => []);

        if (!response.ok) {
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
      } finally {
        timeout.done();
      }
    }
  };
}
