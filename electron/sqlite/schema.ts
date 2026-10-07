import type { DatabaseSync } from 'node:sqlite'

// 只用于新的测试库。未来变更追加迁移，不改写已执行的版本。
export const migrations = [{ version: 1, name: 'initial-test-schema', sql: `
CREATE TABLE boss_identities (
  profile_id TEXT PRIMARY KEY NOT NULL,
  original_boss_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
CREATE TABLE boss_profiles (
  profile_id TEXT PRIMARY KEY NOT NULL REFERENCES boss_identities(profile_id) ON DELETE RESTRICT,
  boss_id TEXT NOT NULL UNIQUE CHECK(length(trim(boss_id)) > 0),
  nickname TEXT NOT NULL,
  hourly_rate_cents INTEGER NOT NULL CHECK(hourly_rate_cents BETWEEN 0 AND 100000000),
  balance_cents INTEGER NOT NULL CHECK(balance_cents BETWEEN -9007199254740991 AND 9007199254740991),
  created_at INTEGER NOT NULL,
  notes TEXT NOT NULL
) STRICT;
CREATE TABLE orders (
  order_id TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL REFERENCES boss_identities(profile_id) ON DELETE RESTRICT,
  boss_id_snapshot TEXT NOT NULL,
  nickname_snapshot TEXT NOT NULL,
  hourly_rate_cents_snapshot INTEGER NOT NULL CHECK(hourly_rate_cents_snapshot > 0),
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  status TEXT NOT NULL CHECK(status IN ('active','paused','completed')),
  accumulated_ms INTEGER NOT NULL CHECK(accumulated_ms >= 0),
  settled_service_seconds INTEGER NOT NULL CHECK(settled_service_seconds >= 0),
  settled_amount_cents INTEGER NOT NULL CHECK(settled_amount_cents >= 0),
  final_charge_cents INTEGER CHECK(final_charge_cents >= 0),
  balance_at_end_cents INTEGER,
  end_reason TEXT,
  created_at INTEGER NOT NULL,
  CHECK((status = 'completed' AND ended_at IS NOT NULL AND final_charge_cents IS NOT NULL AND balance_at_end_cents IS NOT NULL AND end_reason IS NOT NULL)
    OR (status <> 'completed' AND ended_at IS NULL AND final_charge_cents IS NULL AND balance_at_end_cents IS NULL AND end_reason IS NULL))
) STRICT;
CREATE UNIQUE INDEX one_unfinished_order ON orders((1)) WHERE status IN ('active','paused');
CREATE INDEX orders_profile_time ON orders(profile_id, started_at DESC);
CREATE TABLE order_pauses (
  order_id TEXT NOT NULL REFERENCES orders(order_id) ON DELETE RESTRICT,
  sequence INTEGER NOT NULL CHECK(sequence >= 0),
  started_at INTEGER NOT NULL,
  ended_at INTEGER CHECK(ended_at IS NULL OR ended_at >= started_at),
  PRIMARY KEY(order_id, sequence)
) STRICT;
CREATE UNIQUE INDEX one_open_pause ON order_pauses(order_id) WHERE ended_at IS NULL;
CREATE TABLE balance_entries (
  entry_id TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL REFERENCES boss_identities(profile_id) ON DELETE RESTRICT,
  boss_id_snapshot TEXT NOT NULL,
  nickname_snapshot TEXT NOT NULL,
  order_id TEXT REFERENCES orders(order_id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK(type IN ('recharge','manual_add','manual_deduct','order_consumption','debt_clear')),
  delta_cents INTEGER NOT NULL,
  before_cents INTEGER NOT NULL,
  after_cents INTEGER NOT NULL,
  settled_through_seconds INTEGER,
  created_at INTEGER NOT NULL,
  notes TEXT NOT NULL,
  CHECK(after_cents = before_cents + delta_cents),
  CHECK((type = 'order_consumption' AND order_id IS NOT NULL AND settled_through_seconds > 0 AND delta_cents <= 0)
    OR (type <> 'order_consumption' AND order_id IS NULL AND settled_through_seconds IS NULL)),
  CHECK(type NOT IN ('recharge','manual_add') OR delta_cents > 0),
  CHECK(type <> 'manual_deduct' OR (delta_cents < 0 AND after_cents >= 0)),
  CHECK(type <> 'debt_clear' OR (before_cents < 0 AND after_cents = 0 AND delta_cents = -before_cents))
) STRICT;
CREATE UNIQUE INDEX unique_order_settlement ON balance_entries(order_id, settled_through_seconds) WHERE type = 'order_consumption';
CREATE INDEX entries_profile_time ON balance_entries(profile_id, created_at DESC);
CREATE TABLE tips (
  tip_id TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL REFERENCES boss_identities(profile_id) ON DELETE RESTRICT,
  boss_id_snapshot TEXT NOT NULL,
  nickname_snapshot TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0 AND amount_cents <= 9007199254740991),
  received_at INTEGER NOT NULL,
  notes TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX tips_profile_time ON tips(profile_id, received_at DESC);
CREATE TABLE import_batches (
  batch_id TEXT PRIMARY KEY NOT NULL,
  source_digest TEXT NOT NULL UNIQUE,
  source_version INTEGER NOT NULL,
  imported_at INTEGER NOT NULL,
  notes TEXT NOT NULL
) STRICT;
CREATE TRIGGER prevent_delete_busy_profile BEFORE DELETE ON boss_profiles
WHEN EXISTS (SELECT 1 FROM orders WHERE profile_id = OLD.profile_id AND status IN ('active','paused'))
BEGIN SELECT RAISE(ABORT, '该老板当前存在进行中的订单，请先结束订单后再删除。'); END;
` }, { version: 2, name: 'legacy-orders-and-migration-document', sql: `
DROP TRIGGER prevent_delete_busy_profile;
CREATE TABLE orders_new (
  order_id TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL REFERENCES boss_identities(profile_id) ON DELETE RESTRICT,
  boss_id_snapshot TEXT NOT NULL, nickname_snapshot TEXT NOT NULL,
  hourly_rate_cents_snapshot INTEGER NOT NULL CHECK(hourly_rate_cents_snapshot > 0),
  started_at INTEGER NOT NULL, ended_at INTEGER,
  status TEXT NOT NULL CHECK(status IN ('active','paused','completed')),
  accumulated_ms INTEGER NOT NULL CHECK(accumulated_ms >= 0),
  settled_service_seconds INTEGER NOT NULL CHECK(settled_service_seconds >= 0),
  settled_amount_cents INTEGER NOT NULL CHECK(settled_amount_cents >= 0),
  final_charge_cents INTEGER CHECK(final_charge_cents >= 0),
  balance_at_end_cents INTEGER, end_reason TEXT, created_at INTEGER NOT NULL,
  legacy_unbilled INTEGER NOT NULL DEFAULT 0 CHECK(legacy_unbilled IN (0,1)),
  CHECK((legacy_unbilled = 1 AND status = 'completed' AND ended_at IS NOT NULL AND settled_amount_cents = 0 AND final_charge_cents = 0 AND balance_at_end_cents IS NULL)
    OR (legacy_unbilled = 0 AND ((status = 'completed' AND ended_at IS NOT NULL AND final_charge_cents IS NOT NULL AND balance_at_end_cents IS NOT NULL AND end_reason IS NOT NULL)
      OR (status <> 'completed' AND ended_at IS NULL AND final_charge_cents IS NULL AND balance_at_end_cents IS NULL AND end_reason IS NULL))))
) STRICT;
INSERT INTO orders_new SELECT orders.*, 0 FROM orders;
DROP TABLE orders;
ALTER TABLE orders_new RENAME TO orders;
CREATE UNIQUE INDEX one_unfinished_order ON orders((1)) WHERE status IN ('active','paused');
CREATE INDEX orders_profile_time ON orders(profile_id, started_at DESC);
CREATE TRIGGER prevent_delete_busy_profile BEFORE DELETE ON boss_profiles
WHEN EXISTS (SELECT 1 FROM orders WHERE profile_id = OLD.profile_id AND status IN ('active','paused'))
BEGIN SELECT RAISE(ABORT, '该老板当前存在进行中的订单，请先结束订单后再删除。'); END;
ALTER TABLE import_batches ADD COLUMN source_document TEXT;
` }, { version: 3, name: 'native-formal-database', sql: `
CREATE TABLE app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
` }]

// 保留旧流水每一列与 ID；重建仅放宽零秒订单的零金额流水约束。
const oldLedger = migrations[0].sql.slice(migrations[0].sql.indexOf('CREATE TABLE balance_entries'), migrations[0].sql.indexOf('CREATE UNIQUE INDEX unique_order_settlement'))
migrations.push({ version: 4, name: 'order-completion-billing', sql: `
ALTER TABLE orders ADD COLUMN billing_model TEXT NOT NULL DEFAULT 'legacy-periodic' CHECK(billing_model IN ('legacy-periodic','on-completion'));
${oldLedger.replace('CREATE TABLE balance_entries', 'CREATE TABLE balance_entries_new').replace('settled_through_seconds > 0', 'settled_through_seconds >= 0')}
INSERT INTO balance_entries_new SELECT * FROM balance_entries;
DROP TABLE balance_entries;
ALTER TABLE balance_entries_new RENAME TO balance_entries;
CREATE UNIQUE INDEX unique_order_settlement ON balance_entries(order_id, settled_through_seconds) WHERE type = 'order_consumption';
CREATE INDEX entries_profile_time ON balance_entries(profile_id, created_at DESC);
CREATE TRIGGER one_charge_per_new_order BEFORE INSERT ON balance_entries
WHEN NEW.type='order_consumption' AND (SELECT billing_model FROM orders WHERE order_id=NEW.order_id)='on-completion'
  AND EXISTS(SELECT 1 FROM balance_entries WHERE order_id=NEW.order_id AND type='order_consumption')
BEGIN SELECT RAISE(ABORT, '新订单只允许一条消费流水'); END;
` })
export function migrateSchema(db: DatabaseSync) {
  const existing = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()
  if (existing.length && !existing.some(row => row.name === 'schema_migrations')) throw new Error('已有数据库不是本应用测试数据库，已停止打开，未覆盖数据。')
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;')
  // SQLite 重建有外键引用的表时需暂时关闭外键；事务内显式检查，返回前恢复。
  db.exec('PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE')
  try {
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL) STRICT')
    const applied = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all()
    for (const row of applied) {
      if (!migrations.some(m => m.version === row.version && m.name === row.name)) throw new Error('数据库版本不受当前程序支持，已停止打开，未覆盖数据。')
    }
    for (const migration of migrations) {
      if (applied.some(row => row.version === migration.version)) continue
      db.exec(migration.sql)
      db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(migration.version, migration.name, Date.now())
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('结构迁移外键校验失败，原数据已回滚。')
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
  finally { db.exec('PRAGMA foreign_keys = ON') }
}
