import { SQL } from 'bun'
import { drizzle } from 'drizzle-orm/bun-sql'
import { env } from '#shared/config/env'
import * as schema from './schemas'

export const db = drizzle({
  client: new SQL(env.DATABASE_URL),
  // One `defineRelationsPart` per module, merged shallowly (one key per
  // table): a module's part must only declare relations *from its own
  // tables*, or it would replace another module's entry. Every table must
  // appear in some part — see relations.test.ts.
  relations: {
    ...schema.authRelations,
    ...schema.templatesRelations,
    ...schema.runsRelations,
    ...schema.reviewsRelations,
    ...schema.effectsRelations,
    ...schema.jobsRelations,
    ...schema.alertsRelations
  }
})
