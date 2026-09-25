/** biome-ignore-all lint/style/noNonNullAssertion: <Drizzle requires a database URL> */
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  out: './drizzle',
  schema: './src/shared/db/schemas.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: Bun.env.DATABASE_URL!
  }
})
