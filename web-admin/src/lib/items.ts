import type { RowDataPacket } from "mysql2";
import { execute, query, queryOne, schema, tableExists, transaction, type SqlParam } from "./db";
import { env } from "./env";

/**
 * Itemization.
 *
 * The realm's gear rules are documented in docs/PHASE3-ITEMIZATION.md; two of
 * its findings shape this file entirely.
 *
 * **`AllowableClass` is signed, and -1 means "every class".** Treating it as a
 * plain bitmask makes -1 read as "all bits set", which happens to be true, but
 * a UI that renders it as thirteen ticked boxes is telling the operator
 * something false about the row. It is displayed as "unrestricted".
 *
 * **The class mask is the weaker of two gates.** Armour proficiency is a skill
 * granted by a spell and checked separately (PlayerStorage.cpp:2339), and plate
 * is sold only by Warrior and Paladin trainers. Clearing the mask does not hand
 * a robe-wearer plate; the proficiency ladder still holds. That is why clearing
 * it was safe in Phase 3, and it is worth repeating on the page, because
 * "unrestrict this item" reads far more dangerous than it is.
 *
 * ## Staged, then promoted
 *
 * An administrator stages a change; an owner promotes it. The intermediate row
 * is not ceremony - it is the same discipline as
 * `modules/mod-classless/data/sql-staged/`, where generated migrations are
 * written but must not run until somebody decides they should.
 */

/** WotLK class bits, for rendering a mask that is not -1. */
const CLASS_BITS: [bit: number, name: string][] = [
  [1 << 0, "Warrior"],
  [1 << 1, "Paladin"],
  [1 << 2, "Hunter"],
  [1 << 3, "Rogue"],
  [1 << 4, "Priest"],
  [1 << 5, "Death Knight"],
  [1 << 6, "Shaman"],
  [1 << 7, "Mage"],
  [1 << 8, "Warlock"],
  [1 << 10, "Druid"],
];

export function describeAllowableClass(mask: number): string {
  if (mask === -1) return "Unrestricted";
  if (mask === 0) return "No class (unobtainable)";
  const names = CLASS_BITS.filter(([bit]) => (mask & bit) !== 0).map(([, name]) => name);
  return names.length > 0 ? names.join(", ") : `mask ${mask}`;
}

export interface ItemRow {
  entry: number;
  name: string;
  quality: number;
  itemLevel: number;
  requiredLevel: number;
  inventoryType: number;
  itemClass: number;
  subclass: number;
  allowableClass: number;
  originalAllowableClass: number | null;
  staged: StagedChange | null;
}

export interface StagedChange {
  id: number;
  itemEntry: number;
  itemName: string | null;
  field: string;
  oldValue: number | null;
  newValue: number;
  state: "staged" | "promoted" | "withdrawn";
  reason: string | null;
  stagedBy: string;
  stagedAt: Date;
  promotedBy: string | null;
  promotedAt: Date | null;
}

export interface ItemizationSummary {
  total: number;
  restricted: number;
  unrestricted: number;
  backupRows: number | null;
  stagedCount: number;
}

/**
 * The state of the pass, in four numbers.
 *
 * `classless_item_class_backup` is what makes the Phase 3 change reversible; if
 * it is missing the page says so rather than implying the change can be undone.
 */
export async function itemizationSummary(): Promise<ItemizationSummary> {
  const hasBackup = await tableExists(env.db.world, "classless_item_class_backup");

  const [counts, backup, staged] = await Promise.all([
    queryOne<RowDataPacket & { total: number; restricted: number }>(
      `SELECT COUNT(*) AS total,
              SUM(AllowableClass <> -1) AS restricted
         FROM ${schema.world}.\`item_template\`
        WHERE class IN (2, 4)`,
    ),
    hasBackup
      ? queryOne<RowDataPacket & { n: number }>(
          `SELECT COUNT(*) AS n FROM ${schema.world}.\`classless_item_class_backup\``,
        )
      : Promise.resolve(null),
    queryOne<RowDataPacket & { n: number }>(
      `SELECT COUNT(*) AS n FROM ${schema.admin}.\`admin_item_change\` WHERE state = 'staged'`,
    ),
  ]);

  const total = Number(counts?.total ?? 0);
  const restricted = Number(counts?.restricted ?? 0);

  return {
    total,
    restricted,
    unrestricted: total - restricted,
    backupRows: backup ? Number(backup.n) : null,
    stagedCount: Number(staged?.n ?? 0),
  };
}

export interface ItemSearch {
  q?: string;
  only?: "all" | "restricted" | "staged";
  limit?: number;
  offset?: number;
}

export async function searchItems(search: ItemSearch): Promise<{ rows: ItemRow[]; total: number }> {
  const limit = Math.min(200, Math.max(1, search.limit ?? 50));
  const offset = Math.max(0, search.offset ?? 0);
  const hasBackup = await tableExists(env.db.world, "classless_item_class_backup");

  // Weapons (class 2) and armour (class 4) are the only categories a class mask
  // is meaningful on. Including consumables would drown the list.
  const where = ["it.class IN (2, 4)"];
  const params: SqlParam[] = [];

  const q = search.q?.trim();
  if (q) {
    if (/^\d+$/.test(q)) {
      where.push("(it.entry = ? OR it.name LIKE ?)");
      params.push(Number(q), `%${q}%`);
    } else {
      where.push("it.name LIKE ?");
      params.push(`%${q}%`);
    }
  }

  if (search.only === "restricted") where.push("it.AllowableClass <> -1");
  if (search.only === "staged") {
    where.push(
      `EXISTS (SELECT 1 FROM ${schema.admin}.\`admin_item_change\` ic
                WHERE ic.item_entry = it.entry AND ic.state = 'staged')`,
    );
  }

  const clause = `WHERE ${where.join(" AND ")}`;
  const backupSelect = hasBackup
    ? `(SELECT b.AllowableClass FROM ${schema.world}.\`classless_item_class_backup\` b WHERE b.entry = it.entry)`
    : "NULL";

  const rows = await query<RowDataPacket & {
    entry: number;
    name: string;
    Quality: number;
    ItemLevel: number;
    RequiredLevel: number;
    InventoryType: number;
    class: number;
    subclass: number;
    AllowableClass: number;
    original_class: number | null;
  }>(
    `SELECT it.entry, it.name, it.Quality, it.ItemLevel, it.RequiredLevel, it.InventoryType,
            it.class, it.subclass, it.AllowableClass, ${backupSelect} AS original_class
       FROM ${schema.world}.\`item_template\` it
       ${clause}
      ORDER BY it.ItemLevel DESC, it.entry
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );

  const counted = await query<RowDataPacket & { n: number }>(
    `SELECT COUNT(*) AS n FROM ${schema.world}.\`item_template\` it ${clause}`,
    params,
  );

  const entries = rows.map((row) => row.entry);
  const staged = entries.length > 0 ? await stagedFor(entries) : new Map<number, StagedChange>();

  return {
    rows: rows.map((row) => ({
      entry: row.entry,
      name: row.name,
      quality: row.Quality,
      itemLevel: row.ItemLevel,
      requiredLevel: row.RequiredLevel,
      inventoryType: row.InventoryType,
      itemClass: row.class,
      subclass: row.subclass,
      allowableClass: row.AllowableClass,
      originalAllowableClass: row.original_class,
      staged: staged.get(row.entry) ?? null,
    })),
    total: Number(counted[0]?.n ?? 0),
  };
}

function toStaged(row: Record<string, unknown>): StagedChange {
  return {
    id: Number(row.id),
    itemEntry: Number(row.item_entry),
    itemName: (row.item_name as string | null) ?? null,
    field: String(row.field),
    oldValue: row.old_value === null ? null : Number(row.old_value),
    newValue: Number(row.new_value),
    state: row.state as StagedChange["state"],
    reason: (row.reason as string | null) ?? null,
    stagedBy: String(row.staged_by),
    stagedAt: row.staged_at as Date,
    promotedBy: (row.promoted_by as string | null) ?? null,
    promotedAt: (row.promoted_at as Date | null) ?? null,
  };
}

async function stagedFor(entries: number[]): Promise<Map<number, StagedChange>> {
  const placeholders = entries.map(() => "?").join(", ");
  const rows = await query<RowDataPacket>(
    `SELECT * FROM ${schema.admin}.\`admin_item_change\`
      WHERE state = 'staged' AND item_entry IN (${placeholders})`,
    entries,
  );
  return new Map(rows.map((row) => {
    const change = toStaged(row as unknown as Record<string, unknown>);
    return [change.itemEntry, change];
  }));
}

export async function listStaged(state: StagedChange["state"] = "staged", limit = 100): Promise<StagedChange[]> {
  const rows = await query<RowDataPacket>(
    `SELECT * FROM ${schema.admin}.\`admin_item_change\`
      WHERE state = ? ORDER BY id DESC LIMIT ${Math.max(1, Math.min(500, Math.trunc(limit)))}`,
    [state],
  );
  return rows.map((row) => toStaged(row as unknown as Record<string, unknown>));
}

export async function getStaged(id: number): Promise<StagedChange | null> {
  const row = await queryOne<RowDataPacket>(
    `SELECT * FROM ${schema.admin}.\`admin_item_change\` WHERE id = ? LIMIT 1`,
    [id],
  );
  return row ? toStaged(row as unknown as Record<string, unknown>) : null;
}

export async function stageChange(input: {
  entry: number;
  newValue: number;
  reason: string;
  stagedBy: string;
}): Promise<StagedChange> {
  const item = await queryOne<RowDataPacket & { entry: number; name: string; AllowableClass: number }>(
    `SELECT entry, name, AllowableClass FROM ${schema.world}.\`item_template\` WHERE entry = ? LIMIT 1`,
    [input.entry],
  );
  if (!item) throw new Error(`No item with entry ${input.entry}.`);
  if (item.AllowableClass === input.newValue) throw new Error("That is already the item's value.");

  const result = await execute(
    `INSERT INTO ${schema.admin}.\`admin_item_change\`
       (item_entry, item_name, field, old_value, new_value, state, reason, staged_by)
     VALUES (?, ?, 'AllowableClass', ?, ?, 'staged', ?, ?)`,
    [item.entry, item.name.slice(0, 128), item.AllowableClass, input.newValue, input.reason.slice(0, 512), input.stagedBy.slice(0, 32)],
  );

  const staged = await getStaged(result.insertId);
  if (!staged) throw new Error("The change was staged but could not be read back.");
  return staged;
}

/**
 * Apply a staged change to the world database.
 *
 * `old_value` is re-checked against the live row inside the transaction. If the
 * item changed since staging - an upstream data bump, another promotion - the
 * promotion is refused rather than silently overwriting a value nobody reviewed.
 */
export async function promoteChange(id: number, promotedBy: string): Promise<void> {
  const change = await getStaged(id);
  if (!change) throw new Error("No such staged change.");
  if (change.state !== "staged") throw new Error(`That change is already ${change.state}.`);

  await transaction(async (run) => {
    const current = await run.query<RowDataPacket & { AllowableClass: number }>(
      `SELECT AllowableClass FROM ${schema.world}.\`item_template\` WHERE entry = ? FOR UPDATE`,
      [change.itemEntry],
    );
    const live = current[0];
    if (!live) throw new Error(`Item ${change.itemEntry} no longer exists.`);
    if (live.AllowableClass !== change.oldValue) {
      throw new Error(
        `Item ${change.itemEntry} has changed since this was staged (${change.oldValue} → ${live.AllowableClass}). ` +
          `Withdraw it and stage the change again against the current value.`,
      );
    }

    await run.execute(`UPDATE ${schema.world}.\`item_template\` SET AllowableClass = ? WHERE entry = ?`, [
      change.newValue,
      change.itemEntry,
    ]);
    await run.execute(
      `UPDATE ${schema.admin}.\`admin_item_change\`
          SET state = 'promoted', promoted_by = ?, promoted_at = NOW()
        WHERE id = ? AND state = 'staged'`,
      [promotedBy.slice(0, 32), id],
    );
  });
}

export async function withdrawChange(id: number): Promise<void> {
  const result = await execute(
    `UPDATE ${schema.admin}.\`admin_item_change\` SET state = 'withdrawn' WHERE id = ? AND state = 'staged'`,
    [id],
  );
  if (result.affectedRows === 0) throw new Error("That change is not staged.");
}
