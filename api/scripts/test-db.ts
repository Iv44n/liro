/**
 * Prepares the test database: creates it if missing, then pushes the current
 * Drizzle schema to it. Run with `bun run test:db` before `bun test` (and
 * again after schema changes).
 */
import { readFileSync } from 'node:fs'
import { SQL } from 'bun'

const testUrl = process.env.TEST_DATABASE_URL ?? readTestUrl()
const url = new URL(testUrl)
const database = url.pathname.slice(1)

if (!database.endsWith('_test')) {
  console.error(
    `Refusing to prepare "${database}": test databases must end with _test`
  )
  process.exit(1)
}

const adminUrl = new URL(testUrl)
adminUrl.pathname = '/postgres'

const admin = new SQL(adminUrl.toString())
const [existing] =
  await admin`select 1 as found from pg_database where datname = ${database}`
if (!existing) {
  // Identifiers can't be parameterized; `database` is validated above.
  await admin.unsafe(`create database "${database.replaceAll('"', '')}"`)
  console.log(`Created database ${database}`)
}
await admin.close()

const push = Bun.spawn(
  [
    'bunx',
    '--bun',
    'drizzle-kit',
    'push',
    '--force',
    '--config',
    'drizzle.config.ts'
  ],
  {
    env: { ...process.env, DATABASE_URL: testUrl },
    stdout: 'inherit',
    stderr: 'inherit'
  }
)
process.exit(await push.exited)

function readTestUrl(): string {
  const line = readFileSync(new URL('../.env.test', import.meta.url), 'utf8')
    .split('\n')
    .find(entry => entry.startsWith('DATABASE_URL='))
  if (!line) throw new Error('DATABASE_URL missing from .env.test')
  return line.slice('DATABASE_URL='.length).trim()
}
