// Press release routes — feeds the Dashboard press archive screen.
import { Hono } from 'hono'
import { db } from '../../db/client.js'
import { pressReleases, pressSources, pressScraperRuns } from '../../db/schema.js'
import { eq, desc } from 'drizzle-orm'
import { runAllPressSources, runPressSource } from '../../press/runner.js'

const router = new Hono()

function timeAgo(date: Date): string {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000)
  if (secs < 60)   return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60)   return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)    return `${hrs} hr ago`
  return `${Math.floor(hrs / 24)} days ago`
}

function utcLabel(date: Date): string {
  return (
    date.toLocaleDateString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' })
      .split('/').reverse().join('-') +
    ' ' +
    date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) +
    ' UTC'
  )
}

// ---------------------------------------------------------------------------
// GET /api/releases — latest press releases, shaped for the Dashboard feed
// ---------------------------------------------------------------------------
router.get('/', async c => {
  const limit = Math.min(Number(c.req.query('limit') ?? 20), 100)

  const rows = await db
    .select({
      id:            pressReleases.id,
      sourceCode:    pressSources.code,
      sourceName:    pressSources.name,
      docRef:        pressReleases.docRef,
      externalId:    pressReleases.externalId,
      headline:      pressReleases.headline,
      url:           pressReleases.url,
      publishedAt:   pressReleases.publishedAt,
      category:      pressReleases.category,
      jurisdiction:  pressReleases.jurisdiction,
      effectiveDate: pressReleases.effectiveDate,
      aiSummary:     pressReleases.aiSummary,
      imageUrl:      pressReleases.imageUrl,
      createdAt:     pressReleases.createdAt,
    })
    .from(pressReleases)
    .innerJoin(pressSources, eq(pressSources.id, pressReleases.sourceId))
    .orderBy(desc(pressReleases.publishedAt), desc(pressReleases.createdAt))
    .limit(limit)

  const releases = rows.map(r => {
    const refDate = r.publishedAt ? new Date(r.publishedAt) : new Date(r.createdAt)
    return {
      id:           r.id,
      source:       r.sourceCode,
      category:     r.category ?? 'Industry',
      doc:          r.docRef ?? r.externalId,
      headline:     r.headline,
      url:          r.url ?? null,
      imageUrl:     r.imageUrl ?? null,
      time:         timeAgo(refDate),
      date:         utcLabel(refDate),
      summary:      r.aiSummary ?? 'AI summary pending…',
      jurisdiction: r.jurisdiction ?? '—',
      effective:    r.effectiveDate ?? '—',
    }
  })

  return c.json({ releases })
})

// ---------------------------------------------------------------------------
// GET /api/releases/:id — full detail for a single press release
// ---------------------------------------------------------------------------
router.get('/:id', async c => {
  const id = Number(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400)

  const rows = await db
    .select({
      id:            pressReleases.id,
      sourceCode:    pressSources.code,
      sourceName:    pressSources.name,
      docRef:        pressReleases.docRef,
      externalId:    pressReleases.externalId,
      headline:      pressReleases.headline,
      url:           pressReleases.url,
      publishedAt:   pressReleases.publishedAt,
      category:      pressReleases.category,
      jurisdiction:  pressReleases.jurisdiction,
      effectiveDate: pressReleases.effectiveDate,
      aiSummary:     pressReleases.aiSummary,
      imageUrl:      pressReleases.imageUrl,
      fullContent:   pressReleases.fullContent,
      content:       pressReleases.content,
      createdAt:     pressReleases.createdAt,
    })
    .from(pressReleases)
    .innerJoin(pressSources, eq(pressSources.id, pressReleases.sourceId))
    .where(eq(pressReleases.id, id))
    .limit(1)

  if (rows.length === 0) return c.json({ error: 'Not found' }, 404)
  const r = rows[0]
  const refDate = r.publishedAt ? new Date(r.publishedAt) : new Date(r.createdAt)

  return c.json({
    release: {
      id:           r.id,
      source:       r.sourceCode,
      sourceName:   r.sourceName,
      category:     r.category ?? 'Industry',
      doc:          r.docRef ?? r.externalId,
      headline:     r.headline,
      url:          r.url ?? null,
      imageUrl:     r.imageUrl ?? null,
      time:         timeAgo(refDate),
      date:         utcLabel(refDate),
      summary:      r.aiSummary ?? null,
      jurisdiction: r.jurisdiction ?? null,
      effective:    r.effectiveDate ?? null,
      fullContent:  r.fullContent ?? r.content ?? null,
    },
  })
})

// ---------------------------------------------------------------------------
// GET /api/press-sources/status — per-source health cards (same shape as
// scraper status but for press sources). Also exposes recent run history.
// ---------------------------------------------------------------------------
router.get('/sources/status', async c => {
  const allSources = await db.query.pressSources.findMany({ orderBy: s => s.name })

  const sources = await Promise.all(allSources.map(async s => {
    const runs = await db.query.pressScraperRuns.findMany({
      where: eq(pressScraperRuns.sourceId, s.id),
      orderBy: r => desc(r.startedAt),
      limit: 12,
    })

    const history = runs
      .slice()
      .reverse()
      .map(r => {
        if (r.status === 'ok')   return 100
        if (r.status === 'warn') return r.itemsCollected > 0 ? 70 : 40
        return 0
      })

    while (history.length < 12) history.unshift(100)

    const rate = Math.round(history.reduce((a, b) => a + b, 0) / 12 * 10) / 10

    const okRuns = runs.filter(r => r.itemsCollected > 0)
    const avg = okRuns.length > 0
      ? Math.round(okRuns.reduce((a, r) => a + r.itemsCollected, 0) / okRuns.length)
      : 0

    const last = runs[0]
    const lastDate = last ? new Date(last.startedAt) : null

    return {
      id:         s.id,
      name:       s.name,
      code:       s.code,
      url:        s.url.replace(/^https?:\/\//, ''),
      status:     s.status as 'healthy' | 'degraded' | 'down',
      lastRun:    lastDate ? timeAgo(lastDate) : 'never',
      lastRunAbs: last?.completedAt
        ? new Date(last.completedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC'
        : '—',
      items:      last?.itemsCollected ?? 0,
      avg,
      rate,
      history,
    }
  }))

  return c.json({ scrapers: sources })
})

// ---------------------------------------------------------------------------
// POST /api/releases/run-all — trigger all press scrapers manually
// ---------------------------------------------------------------------------
router.post('/run-all', async c => {
  runAllPressSources().catch(console.error)
  return c.json({ message: 'Press scrape run started' }, 202)
})

// ---------------------------------------------------------------------------
// POST /api/releases/run/:sourceId — trigger a single press source
// ---------------------------------------------------------------------------
router.post('/run/:sourceId', async c => {
  const sourceId = Number(c.req.param('sourceId'))
  runPressSource(sourceId).catch(console.error)
  return c.json({ message: `Press scrape started for source ${sourceId}` }, 202)
})

export default router
