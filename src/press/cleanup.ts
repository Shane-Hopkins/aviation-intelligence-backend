// One-time cleanup: delete press releases that have no fullContent and no
// meaningful content (i.e. scraped before article enrichment was added).
// Run with: npx tsx src/press/cleanup.ts
import { db } from '../db/client.js'
import { pressReleases } from '../db/schema.js'
import { isNull, or, sql } from 'drizzle-orm'

async function main() {
  const deleted = await db
    .delete(pressReleases)
    .where(
      or(
        isNull(pressReleases.fullContent),
        sql`${pressReleases.fullContent} = ''`,
      )
    )
    .returning({ id: pressReleases.id })

  console.log(`Deleted ${deleted.length} empty press releases.`)
  process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })
