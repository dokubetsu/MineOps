/**
 * Pre-handover go-live smoke (repo + optional local DB).
 * Run from frontend/: node scripts/golive-smoke-check.mjs
 *
 * Remote client project (Upstash, bootstrap rotate, live settle) still requires
 * operator steps in docs/CLIENT_DEPLOY.md §8 and docs/DEPLOYMENT_CHECKLIST.md §6.
 */

import { readFileSync, existsSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..', '..')
const failures = []

function ok(msg) {
  console.log(`  PASS  ${msg}`)
}
function fail(msg) {
  console.error(`  FAIL  ${msg}`)
  failures.push(msg)
}

console.log('Khani go-live smoke (repo invariants)\n')

// Migrations through 068
const migDir = join(root, 'supabase', 'migrations')
const migs = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()
const has067 = migs.some((f) => f.startsWith('067_'))
const has068 = migs.some((f) => f.startsWith('068_'))
if (has067) ok(`migration 067 present (${migs.filter((f) => f.startsWith('067_'))[0]})`)
else fail('migration 067 missing')
if (has068) ok(`migration 068 present (${migs.filter((f) => f.startsWith('068_'))[0]})`)
else fail('migration 068 missing')

const mig068 = readFileSync(join(migDir, '068_period_purge_leave_and_settlement_admin.sql'), 'utf8')
if (/v_is_service|service_role/.test(mig068) && /unapprove_leave_application/.test(mig068)) {
  ok('068 unapprove allows service_role')
} else fail('068 missing service_role bypass in unapprove')
if (/settlement_admin_only/.test(mig068) && /Only admins can settle/.test(mig068)) {
  ok('068 enforces settlement_admin_only at DB')
} else fail('068 missing settlement_admin_only DB gate')

// Period-ops fail-closed
const periodOps = readFileSync(
  join(root, 'frontend', 'src', 'app', 'api', 'admin', 'period-ops', 'route.ts'),
  'utf8'
)
if (
  /Leave balance restore failed before purge/.test(periodOps) &&
  /unapprove_leave_application/.test(periodOps)
) {
  ok('period-ops fails closed if leave unapprove fails')
} else fail('period-ops still soft-warns on unapprove failure')

// Docs aligned
const docs = [
  ['docs/CLIENT_DEPLOY.md', /067/],
  ['docs/DEPLOYMENT_CHECKLIST.md', /068/],
  ['README.md', /068_period_purge_leave_and_settlement_admin/],
  ['docs/SCHEMA_SSOT.md', /068_period_purge_leave_and_settlement_admin/],
]
for (const [rel, re] of docs) {
  const text = readFileSync(join(root, rel), 'utf8')
  if (re.test(text)) ok(`${rel} mentions latest migrations`)
  else fail(`${rel} not updated for 067/068`)
}

// CLIENT_DEPLOY must not claim "through 064" as the terminal target
const clientDeploy = readFileSync(join(root, 'docs', 'CLIENT_DEPLOY.md'), 'utf8')
if (/db push \(064\)/.test(clientDeploy) || /Migrations \(Through 064\)/.test(clientDeploy)) {
  fail('CLIENT_DEPLOY still targets migration 064 as latest')
} else ok('CLIENT_DEPLOY no longer targets 064 as latest')

if (/Unload clerk|settlement admin-only/i.test(clientDeploy)) {
  ok('CLIENT_DEPLOY smoke includes unload / settlement admin-only')
} else fail('CLIENT_DEPLOY smoke missing unload/settlement checks')

// Optional: probe configured Supabase
const envPath = join(root, 'frontend', '.env.local')
if (existsSync(envPath)) {
  const env = Object.fromEntries(
    readFileSync(envPath, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => {
        const i = l.indexOf('=')
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
      })
  )
  const url = env.NEXT_PUBLIC_SUPABASE_URL || ''
  if (url) ok(`.env.local has Supabase URL (${url.replace(/https?:\/\//, '').slice(0, 40)}…)`)
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log(
      '  NOTE  SUPABASE_SERVICE_ROLE_KEY not in .env.local — skip live DB probes; use CI / linked project'
    )
  }
  if (/supabase\.co/i.test(url)) {
    console.log(
      '  NOTE  Remote Supabase detected. Complete CLIENT_DEPLOY §8 on that project (Upstash, bootstrap rotate, settle→cash IN).'
    )
  }
} else {
  console.log('  NOTE  No frontend/.env.local — local/CI env only')
}

console.log('')
if (failures.length) {
  console.error(`Go-live smoke FAILED (${failures.length}):`)
  failures.forEach((f) => console.error(`  - ${f}`))
  process.exit(1)
}
console.log('Go-live smoke PASSED (repo). Run docs/CLIENT_DEPLOY.md §8 on the client project next.')
process.exit(0)
