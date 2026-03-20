import { neon } from "@neondatabase/serverless";

const TABLE_NAME = "teleai_state_backup_history";

function toMillis(value) {
  return value ? new Date(value).getTime() : 0;
}

function createNoopBackupService() {
  return {
    enabled: false,
    async restoreLatest() {
      return { restored: false, reason: "no_database_url" };
    },
    async backupNow() {
      return { skipped: true, reason: "no_database_url" };
    },
    async listBackups() {
      return [];
    },
    async getLatestBackupSnapshot() {
      return null;
    },
    async getBackupSnapshot() {
      return null;
    },
    startScheduler() {
      return () => {};
    }
  };
}

export function createNeonBackupService({ config, store }) {
  if (!config.neonDatabaseUrl) {
    return createNoopBackupService();
  }

  let schemaReady = false;

  async function ensureSchema() {
    if (schemaReady) {
      return;
    }

    const sql = neon(config.neonDatabaseUrl);
    await sql.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
        snapshot_id BIGSERIAL PRIMARY KEY,
        backup_key TEXT NOT NULL,
        app_name TEXT NOT NULL,
        snapshot JSONB NOT NULL,
        source_updated_at TIMESTAMPTZ NULL,
        synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await sql.query(`
      CREATE INDEX IF NOT EXISTS idx_${TABLE_NAME}_backup_key_synced
      ON ${TABLE_NAME} (backup_key, synced_at DESC, snapshot_id DESC)
    `);

    schemaReady = true;
  }

  async function listBackups() {
    await ensureSchema();

    const sql = neon(config.neonDatabaseUrl);
    const rows = await sql.query(
      `SELECT snapshot_id, backup_key, app_name, source_updated_at, synced_at
       FROM ${TABLE_NAME}
       WHERE backup_key = $1
       ORDER BY synced_at DESC, snapshot_id DESC
       LIMIT 2`,
      [config.neonBackupKey]
    );

    return rows.map((row, index) => ({
      snapshotId: row.snapshot_id,
      backupKey: row.backup_key,
      appName: row.app_name,
      sourceUpdatedAt: row.source_updated_at,
      syncedAt: row.synced_at,
      label: index === 0 ? "Latest Backup" : "Previous Backup",
      rank: index + 1
    }));
  }

  async function getBackupSnapshot(snapshotId) {
    await ensureSchema();

    const sql = neon(config.neonDatabaseUrl);
    const rows = await sql.query(
      `SELECT snapshot_id, backup_key, app_name, snapshot, source_updated_at, synced_at
       FROM ${TABLE_NAME}
       WHERE backup_key = $1 AND snapshot_id = $2
       LIMIT 1`,
      [config.neonBackupKey, snapshotId]
    );

    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      snapshotId: row.snapshot_id,
      backupKey: row.backup_key,
      appName: row.app_name,
      sourceUpdatedAt: row.source_updated_at,
      syncedAt: row.synced_at,
      snapshot: row.snapshot
    };
  }

  async function getLatestBackupSnapshot() {
    const backups = await listBackups();
    if (backups.length === 0) {
      return null;
    }

    return getBackupSnapshot(backups[0].snapshotId);
  }

  async function restoreLatest() {
    const latest = await getLatestBackupSnapshot();
    if (!latest) {
      return { restored: false, reason: "no_snapshot" };
    }

    const remoteUpdatedAt = latest.sourceUpdatedAt || latest.syncedAt || null;
    const localUpdatedAt = store.getStateUpdatedAt();
    const localSummary = store.getSummary();
    const localHasState =
      localSummary.totalUsers > 0 ||
      localSummary.totalSessions > 0 ||
      localSummary.totalCommands > 0 ||
      localSummary.totalAiMessages > 0;
    const shouldUseRemote = !localHasState || toMillis(remoteUpdatedAt) > toMillis(localUpdatedAt);

    if (shouldUseRemote) {
      await store.replaceState(latest.snapshot);
    }

    await store.markNeonRestore(remoteUpdatedAt);

    return {
      restored: shouldUseRemote,
      sourceUpdatedAt: remoteUpdatedAt
    };
  }

  async function backupNow(reason = "interval") {
    await ensureSchema();

    const snapshot = store.exportState();
    const sourceUpdatedAt = store.getStateUpdatedAt() || new Date().toISOString();
    const syncedAt = new Date().toISOString();
    const sql = neon(config.neonDatabaseUrl);

    try {
      await sql.query(
        `INSERT INTO ${TABLE_NAME} (backup_key, app_name, snapshot, source_updated_at, synced_at)
         VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz)`,
        [
          config.neonBackupKey,
          config.appName,
          JSON.stringify(snapshot),
          sourceUpdatedAt,
          syncedAt
        ]
      );
      await sql.query(
        `DELETE FROM ${TABLE_NAME}
         WHERE backup_key = $1
           AND snapshot_id NOT IN (
             SELECT snapshot_id
             FROM ${TABLE_NAME}
             WHERE backup_key = $1
             ORDER BY synced_at DESC, snapshot_id DESC
             LIMIT 2
           )`,
        [config.neonBackupKey]
      );

      await store.markNeonBackup({ syncedAt, reason });

      return {
        syncedAt,
        reason
      };
    } catch (error) {
      await store.markNeonBackupError(error.message);
      throw error;
    }
  }

  function startScheduler() {
    const intervalMs = config.backupIntervalMinutes * 60 * 1000;
    const timer = setInterval(() => {
      backupNow("interval").catch((error) => {
        console.error("Neon backup failed:", error.message);
      });
    }, intervalMs);

    if (typeof timer.unref === "function") {
      timer.unref();
    }

    return () => clearInterval(timer);
  }

  return {
    enabled: true,
    restoreLatest,
    backupNow,
    listBackups,
    getLatestBackupSnapshot,
    getBackupSnapshot,
    startScheduler
  };
}
