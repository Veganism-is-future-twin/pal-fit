// Thin helpers around D1. ALWAYS pass values as bind parameters (`?`) —
// never build SQL by gluing strings together (SQL injection).
//
//   const user = await first(env.DB, 'SELECT * FROM users WHERE id = ?', id);
//   const rows = await all(env.DB, 'SELECT * FROM logs WHERE user_id = ?', id);
//   await run(env.DB, 'UPDATE users SET active = 0 WHERE id = ?', id);

/** First row or null. */
export async function first(db, sql, ...binds) {
  return (await db.prepare(sql).bind(...binds).first()) ?? null;
}

/** All rows as an array. */
export async function all(db, sql, ...binds) {
  const { results } = await db.prepare(sql).bind(...binds).all();
  return results ?? [];
}

/** Run a write; returns D1 meta (changes, last_row_id, ...). */
export async function run(db, sql, ...binds) {
  const { meta } = await db.prepare(sql).bind(...binds).run();
  return meta;
}

/**
 * Run several statements atomically (all succeed or none do).
 *   await batch(env.DB, [[sql1, a, b], [sql2, c]]);
 */
export async function batch(db, statements) {
  return db.batch(statements.map(([sql, ...binds]) => db.prepare(sql).bind(...binds)));
}

/** New random UUID for primary keys. */
export function newId() {
  return crypto.randomUUID();
}
