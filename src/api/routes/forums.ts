import { Hono } from 'hono'
import { db } from '../../db/client.js'
import { forums, posts, sentimentAnalyses, scraperRuns } from '../../db/schema.js'
import { eq, desc, sql, gte } from 'drizzle-orm'

const router = new Hono()

// GET /api/forums
// Returns all forums with status, post counts, and net sentiment (7 days).
router.get('/', async c => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const allForums = await db.query.forums.findMany({
    orderBy: f => f.name,
  })

  // Get post counts + sentiment per forum for last 7 days
  const stats = await db
    .select({
      forumId: posts.forumId,
      postCount: sql<number>`count(distinct posts.id)`,
      avgScore: sql<number>`avg(${sentimentAnalyses.score})`,
    })
    .from(posts)
    .leftJoin(sentimentAnalyses, eq(sentimentAnalyses.postId, posts.id))
    .where(gte(posts.postedAt, sevenDaysAgo))
    .groupBy(posts.forumId)
    .then(rows => new Map(rows.map(r => [r.forumId, r])))

  const result = allForums.map(f => {
    const stat = stats.get(f.id)
    const net = Math.round(stat?.avgScore ?? 0)
    const tone = net >= 15 ? 'pos' : net <= -15 ? 'neg' : 'neu'
    const posts7d = stat?.postCount ?? 0

    // Format post count with k suffix for display
    const postsDisplay = posts7d >= 1000
      ? `${(posts7d / 1000).toFixed(1)}k`
      : String(posts7d)

    return {
      id: f.id,
      name: f.name,
      handle: f.handle,
      url: f.url,
      scraperType: f.scraperType,
      status: f.status,
      enabled: f.enabled,
      posts: postsDisplay,
      net,
      tone,
    }
  })

  return c.json({ forums: result })
})

// GET /api/forums/:id — single forum detail
router.get('/:id', async c => {
  const id = Number(c.req.param('id'))
  const forum = await db.query.forums.findFirst({ where: eq(forums.id, id) })
  if (!forum) return c.json({ error: 'Not found' }, 404)

  // Recent runs
  const runs = await db.query.scraperRuns.findMany({
    where: eq(scraperRuns.forumId, id),
    orderBy: r => desc(r.startedAt),
    limit: 12,
  })

  return c.json({ forum, runs })
})

// POST /api/forums — add a new forum (for the "add from dashboard" feature)
const VALID_SCRAPER_TYPES = ['reddit', 'pprune', 'airliners', 'stuckmic', 'pilotsofamerica', 'html'] as const
type ScraperType = typeof VALID_SCRAPER_TYPES[number]

router.post('/', async c => {
  const body = await c.req.json<{
    name?: string
    handle?: string
    url?: string
    scraperType?: string
    scraperConfig?: Record<string, unknown>
  }>()

  if (!body.name || !body.handle || !body.url || !body.scraperType) {
    return c.json({ error: 'name, handle, url, and scraperType are required' }, 400)
  }
  if (!VALID_SCRAPER_TYPES.includes(body.scraperType as ScraperType)) {
    return c.json({ error: `scraperType must be one of: ${VALID_SCRAPER_TYPES.join(', ')}` }, 400)
  }
  const [forum] = await db
    .insert(forums)
    .values({
      name: body.name,
      handle: body.handle,
      url: body.url,
      scraperType: body.scraperType,
      scraperConfig: body.scraperConfig ? JSON.stringify(body.scraperConfig) : null,
    })
    .returning()

  return c.json({ forum }, 201)
})

// PATCH /api/forums/:id — toggle enabled / update config
router.patch('/:id', async c => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json<{ enabled?: boolean; scraperConfig?: Record<string, unknown> }>()

  const updates: Partial<typeof forums.$inferInsert> = {}
  if (typeof body.enabled === 'boolean') updates.enabled = body.enabled
  if (body.scraperConfig) updates.scraperConfig = JSON.stringify(body.scraperConfig)

  const [updated] = await db
    .update(forums)
    .set(updates)
    .where(eq(forums.id, id))
    .returning()

  return c.json({ forum: updated })
})

export default router
