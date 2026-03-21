import express from "express";

function normalizeToken(value) {
  const text = String(value || "").trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }

  return text;
}

function authenticateAdmin(adminToken) {
  const expectedToken = normalizeToken(adminToken);

  return (request, response, next) => {
    const bearer = request.headers.authorization?.startsWith("Bearer ")
      ? request.headers.authorization.slice(7)
      : null;
    const suppliedToken = normalizeToken(request.headers["x-admin-token"] || bearer);

    if (!suppliedToken || suppliedToken !== expectedToken) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }

    next();
  };
}

export function createAdminRouter({ config, store, flowise, neonBackup }) {
  const router = express.Router();

  router.use(authenticateAdmin(config.adminToken));

  router.get("/summary", (request, response) => {
    response.json({
      appName: config.appName,
      flowiseSessionMode: config.flowiseSessionMode,
      messagesPer6Hours: config.messagesPer6Hours,
      neonBackupEnabled: neonBackup.enabled,
      summary: store.getSummary()
    });
  });

  router.get("/backups", async (request, response) => {
    const backups = await neonBackup.listBackups();
    response.json({
      enabled: neonBackup.enabled,
      backups
    });
  });

  router.get("/backups/live", (request, response) => {
    response.json({
      source: "live",
      snapshot: store.exportState()
    });
  });

  router.get("/backups/latest", async (request, response) => {
    const snapshot = await neonBackup.getLatestBackupSnapshot();
    if (!snapshot) {
      response.status(404).json({ error: "No backup found" });
      return;
    }

    response.json({
      source: "latest",
      ...snapshot
    });
  });

  router.get("/backups/:snapshotId", async (request, response) => {
    const snapshot = await neonBackup.getBackupSnapshot(Number(request.params.snapshotId));
    if (!snapshot) {
      response.status(404).json({ error: "Backup not found" });
      return;
    }

    response.json({
      source: "history",
      ...snapshot
    });
  });

  router.get("/users", (request, response) => {
    response.json({
      users: store.listUsers()
    });
  });

  router.get("/users/:userId", (request, response) => {
    const detail = store.getUserDetail(request.params.userId);
    if (!detail) {
      response.status(404).json({ error: "User not found" });
      return;
    }

    response.json(detail);
  });

  router.post("/users/:userId/sessions", async (request, response) => {
    const detail = store.getUserDetail(request.params.userId);
    if (!detail) {
      response.status(404).json({ error: "User not found" });
      return;
    }

    const session = await store.createNewSession(request.params.userId);
    response.status(201).json({ session });
  });

  router.get("/users/:userId/messages", async (request, response) => {
    const detail = store.getUserDetail(request.params.userId);
    if (!detail) {
      response.status(404).json({ error: "User not found" });
      return;
    }

    const sessionKey = String(request.query.sessionKey || detail.activeSessionKey || "");
    if (!sessionKey) {
      response.status(400).json({ error: "sessionKey is required" });
      return;
    }

    const belongsToUser = detail.sessions.some((session) => session.sessionKey === sessionKey);
    if (!belongsToUser) {
      response.status(400).json({ error: "Unknown session for this user" });
      return;
    }

    const session = detail.sessions.find((item) => item.sessionKey === sessionKey);
    if (!session) {
      response.status(400).json({ error: "Session not found" });
      return;
    }

    try {
      const messages = await flowise.getMessages(session);
      response.json({ sessionKey, messages });
    } catch (error) {
      response.status(502).json({ error: error.message });
    }
  });

  return router;
}
