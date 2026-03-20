export function createRateLimiter({ store, limit, windowMs }) {
  return {
    async consume(userId) {
      const user = store.getUserById(userId);
      if (!user) {
        throw new Error(`Unknown user ${userId}`);
      }

      const now = Date.now();
      const cutoff = now - windowMs;
      const currentWindow = (user.rateLimitWindow || []).filter((timestamp) => timestamp > cutoff);

      if (currentWindow.length >= limit) {
        await store.setRateLimitWindow(userId, currentWindow);
        await store.markRateLimited(userId);

        return {
          allowed: false,
          limit,
          used: currentWindow.length,
          remaining: 0,
          resetAt: currentWindow[0] ? new Date(currentWindow[0] + windowMs).toISOString() : null
        };
      }

      currentWindow.push(now);
      await store.setRateLimitWindow(userId, currentWindow);

      return {
        allowed: true,
        limit,
        used: currentWindow.length,
        remaining: Math.max(limit - currentWindow.length, 0),
        resetAt: currentWindow[0] ? new Date(currentWindow[0] + windowMs).toISOString() : null
      };
    }
  };
}
