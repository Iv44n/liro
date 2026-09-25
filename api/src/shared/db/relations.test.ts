import { expect, test } from 'bun:test'
import { getTableName, is } from 'drizzle-orm'
import { PgTable } from 'drizzle-orm/pg-core'
import { db } from './config'
import * as schema from './schemas'

/**
 * Relation parts are merged with a shallow spread and `auth:gen` drops tables
 * without relations: a table missing here breaks `db.query.<table>` and
 * better-auth's adapter ("Drizzle schema mismatch") at runtime.
 */
test('every exported table is registered in the relational query builder', () => {
  const tables = Object.entries(schema)
    .filter(([, value]) => is(value, PgTable))
    .map(([key, value]) => ({ key, name: getTableName(value as PgTable) }))

  expect(tables.length).toBeGreaterThan(0)
  for (const { key } of tables) {
    expect(db.query).toHaveProperty(key)
  }
})
