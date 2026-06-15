// Scraper control routes — trigger runs and view run history.
// Used by the Source Health screen and future dashboard controls.
import { Hono } from 'hono'
import { db } from '../../db/client.js'
import { scraperRuns, forums } from '../../db/schema.js'
import { eq, desc } from 'drizzle-orm'
import { runForumScraper, runAllScrapers } from '../../scrapers/runner.js'
import type { Forum } from '../../db/schema.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(date: Date): string {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000)
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hr ago`
  return `${Math.floor(hrs / 24)} days ago`
}

function utcHHMM(date: Date): string {
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC'
}

// Derive a short display code from forum handle/name for the tile
function forumCode(f: Forum): string {
  const h = f.handle.toLowerCase()
  if (h.startsWith('r/')) return h.slice(0, 6).replace('r/', 'r/')   // "r/av", "r/fly"
  if (h.includes('pprune') && h.includes('rotor')) return 'ROTR'
  if (h.includes('pprune'))    return 'PPRN'
  if (h.includes('airliners')) return 'AIR'
  if (h.includes('stuck'))     return 'STKM'
  if (h.includes('pilots'))    return 'POA'
  // Fallback: first 4 chars of name
  return f.name.replace(/[^a-zA-Z]/g, '').slice(0, 4).toUpperCase()
}

// Map run status → success score for sparkline
function runScore(status: string, items: number): number {
  if (status === 'ok')   return 100
  if (status === 'warn') return items > 0 ? 70 : 40
  return 0
}

// Format a run log message from the run record
function runMessage(status: string, items: number, error: string | null): string {
  if (status === 'ok')   return `Run complete — ${items} posts collected`
  if (status === 'warn') return error ?? `Partial run — ${items} items collected`
  return error ?? 'Run failed'
}

// GET /api/scraper/status
// Per-forum scraper cards with sparkline history — powers the Source Health screen.
router.get('/status', async c => {
  const allForums = await db.query.forums.findMany({ orderBy: f => f.name })

  const scrapers = await Promise.all(allForums.map(async f => {
    // Last 12 completed runs for this forum (oldest first for sparkline)
    const runs = await db.query.scraperRuns.findMany({
      where: eq(scraperRuns.forumId, f.id),
      orderBy: r => desc(r.startedAt),
      limit: 12,
    })

    const history = runs
      .slice()
      .reverse()
      .map(r => runScore(r.status, r.itemsCollected))

    // Pad to 12 with 100 if fewer historical runs
    while (history.length < 12) history.unshift(100)

    const rate = Math.round(history.reduce((a, b) => a + b, 0) / 12 * 10) / 10

    const okRuns = runs.filter(r => r.itemsCollected > 0)
    const avg = okRuns.length > 0
      ? Math.round(okRuns.reduce((a, r) => a + r.itemsCollected, 0) / okRuns.length)
      : 0

    const last = runs[0]
    const url  = f.url.replace(/^https?:\/\//, '')

    return {
      id:         f.id,
      name:       f.name,
      url,
      code:       forumCode(f),
      status:     f.status as 'healthy' | 'degraded' | 'down',
      lastRun:    last ? timeAgo(new Date(last.startedAt)) : 'never',
      lastRunAbs: last?.completedAt ? utcHHMM(new Date(last.completedAt)) : '—',
      items:      last?.itemsCollected ?? 0,
      avg,
      rate,
      history,
    }
  }))

  return c.json({ scrapers })
})

// GET /api/scraper/runs — recent run log across all forums.
// Returns both raw rows (for callers that want full data) and a pre-formatted
// log array (shape matches LogEntry — used directly by the Source Health screen).
router.get('/runs', async c => {
  const limit = Number(c.req.query('limit') ?? 20)

  const runs = await db
    .select({
      id:             scraperRuns.id,
      forumId:        scraperRuns.forumId,
      forumName:      forums.name,
      startedAt:      scraperRuns.startedAt,
      completedAt:    scraperRuns.completedAt,
      itemsCollected: scraperRuns.itemsCollected,
      status:         scraperRuns.status,
      error:          scraperRuns.error,
    })
    .from(scraperRuns)
    .innerJoin(forums, eq(forums.id, scraperRuns.forumId))
    .orderBy(desc(scraperRuns.startedAt))
    .limit(limit)

  // Also shape into the LogEntry format the frontend expects
  const log = runs.map(r => ({
    time:  utcHHMM(new Date(r.startedAt)),
    level: r.status === 'running' ? 'ok' : r.status,
    src:   r.forumName,
    msg:   runMessage(r.status, r.itemsCollected, r.error),
  }))

  return c.json({ runs, log })
})

// POST /api/scraper/run-all — trigger a full scrape run immediately
// (also runs on the scheduler; this is for manual triggers)
router.post('/run-all', async c => {
  // Run in background — don't await
  runAllScrapers().catch(console.error)
  return c.json({ message: 'Scrape run started' }, 202)
})

// POST /api/scraper/run/:forumId — trigger a single forum scrape
router.post('/run/:forumId', async c => {
  const forumId = Number(c.req.param('forumId'))
  runForumScraper(forumId).catch(console.error)
  return c.json({ message: `Scrape started for forum ${forumId}` }, 202)
})

export default router
