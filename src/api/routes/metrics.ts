import { Hono } from 'hono'
import { db } from '../../db/client.js'
import { posts, sentimentAnalyses, forums, scraperRuns, pressReleases, pressSources, pressScraperRuns } from '../../db/schema.js'
import { sql, gte, eq, and, isNotNull, isNull } from 'drizzle-orm'

const router = new Hono()

// GET /api/metrics/community
// Returns the four summary metric cards for the Community Pulse screen.
router.get('/community', async c => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const [forumsCount, postsCount, sentimentAvg, activeDiscussions] = await Promise.all([
    // Forums monitored
    db
      .select({ count: sql<number>`count(*)` })
      .from(forums)
      .where(eq(forums.enabled, true))
      .then(r => r[0]?.count ?? 0),

    // Posts analyzed in last 7 days
    db
      .select({ count: sql<number>`count(*)` })
      .from(posts)
      .where(gte(posts.postedAt, sevenDaysAgo))
      .then(r => r[0]?.count ?? 0),

    // Net sentiment (avg score across analysed posts from last 7 days)
    db
      .select({ avg: sql<number>`avg(${sentimentAnalyses.score})` })
      .from(sentimentAnalyses)
      .innerJoin(posts, eq(posts.id, sentimentAnalyses.postId))
      .where(gte(posts.postedAt, sevenDaysAgo))
      .then(r => Math.round(r[0]?.avg ?? 0)),

    // Active discussions = distinct thread_ids with posts in last 7 days
    db
      .select({ count: sql<number>`count(distinct thread_id)` })
      .from(posts)
      .where(gte(posts.postedAt, sevenDaysAgo))
      .then(r => r[0]?.count ?? 0),
  ])

  const netLabel =
    sentimentAvg >= 20 ? 'positive' :
    sentimentAvg <= -20 ? 'negative' : 'slightly positive'

  return c.json({
    metrics: [
      { label: 'Forums monitored', value: String(forumsCount), trend: '', trendDir: 'flat', foot: 'communities', icon: 'globe' },
      { label: 'Posts analyzed (7d)', value: Number(postsCount).toLocaleString(), trend: '', trendDir: 'up', foot: 'deduplicated', icon: 'doc' },
      { label: 'Net sentiment', value: sentimentAvg >= 0 ? `+${sentimentAvg}` : String(sentimentAvg), trend: '', trendDir: sentimentAvg >= 0 ? 'up' : 'flat', foot: netLabel, icon: 'spark' },
      { label: 'Active discussions', value: Number(activeDiscussions).toLocaleString(), trend: '', trendDir: 'up', foot: 'tracked threads', icon: 'health' },
    ],
  })
})

// GET /api/metrics/health
// Returns the four summary cards for the Source Health screen.
router.get('/health', async c => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const oneDayAgo    = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const todayStart   = new Date(); todayStart.setHours(0, 0, 0, 0)

  const [uptimeRows, runsTodayRows, latencyRows, failedRows, sourceCountRows] = await Promise.all([
    // Pipeline uptime: % ok runs in last 30 days
    db.select({
      total: sql<number>`count(*)`,
      ok:    sql<number>`sum(case when status = 'ok' then 1 else 0 end)`,
    }).from(scraperRuns).where(gte(scraperRuns.startedAt, thirtyDaysAgo)),

    // Runs today (all statuses)
    db.select({ count: sql<number>`count(*)` })
      .from(scraperRuns).where(gte(scraperRuns.startedAt, todayStart)),

    // Avg seconds-per-item for successful runs
    db.select({
      avg: sql<number>`avg(
        extract(epoch from (completed_at - started_at))
        / nullif(items_collected, 0)
      )`,
    }).from(scraperRuns).where(
      and(eq(scraperRuns.status, 'ok'), isNotNull(scraperRuns.completedAt)),
    ),

    // Failed runs in last 24 h
    db.select({ count: sql<number>`count(*)` })
      .from(scraperRuns).where(
        and(eq(scraperRuns.status, 'err'), gte(scraperRuns.startedAt, oneDayAgo)),
      ),

    // Enabled forum count for "across N sources" label
    db.select({ count: sql<number>`count(*)` })
      .from(forums).where(eq(forums.enabled, true)),
  ])

  const { total, ok } = uptimeRows[0] ?? { total: 0, ok: 0 }
  const uptime = total > 0 ? (Math.round((Number(ok) / Number(total)) * 1000) / 10) : 100

  const latencyRaw = latencyRows[0]?.avg ?? 0
  const latencyDisplay = latencyRaw < 1
    ? `${Math.round(latencyRaw * 1000)}ms`
    : `${Number(latencyRaw).toFixed(1)}s`

  const runsToday  = Number(runsTodayRows[0]?.count ?? 0)
  const failed     = Number(failedRows[0]?.count ?? 0)
  const numSources = Number(sourceCountRows[0]?.count ?? 0)

  // Count down sources with no ok runs in last 24h
  const downRows = await db.select({ count: sql<number>`count(*)` })
    .from(forums).where(eq(forums.status, 'down'))
  const downCount = Number(downRows[0]?.count ?? 0)

  return c.json({
    metrics: [
      { label: 'Pipeline uptime',     value: `${uptime}%`, foot: 'trailing 30 days',          icon: 'check'   },
      { label: 'Runs today',          value: String(runsToday), foot: `across ${numSources} sources`, icon: 'refresh' },
      { label: 'Avg. scrape latency', value: latencyDisplay,    foot: 'per document',           icon: 'clock'   },
      { label: 'Failed runs (24h)',   value: String(failed),    foot: `${downCount} source${downCount !== 1 ? 's' : ''} down`, icon: 'alert' },
    ],
  })
})

// GET /api/metrics/dashboard
// Returns the four summary cards for the Dashboard (press release) screen.
router.get('/dashboard', async c => {
  const oneDayAgo  = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const [totalRows, sourcesRows, summarisedRows, unsummarisedRows, runRows, failedRows] = await Promise.all([
    // Total press releases ever
    db.select({ count: sql<number>`count(*)` }).from(pressReleases),

    // All enabled sources and their status
    db.select({ count: sql<number>`count(*)`, status: pressSources.status })
      .from(pressSources)
      .where(eq(pressSources.enabled, true))
      .groupBy(pressSources.status),

    // Releases with AI summaries
    db.select({ count: sql<number>`count(*)` })
      .from(pressReleases)
      .where(isNotNull(pressReleases.aiSummary)),

    // Releases without summaries (pending)
    db.select({ count: sql<number>`count(*)` })
      .from(pressReleases)
      .where(isNull(pressReleases.aiSummary)),

    // Total runs in last 24h
    db.select({ count: sql<number>`count(*)` })
      .from(pressScraperRuns)
      .where(gte(pressScraperRuns.startedAt, oneDayAgo)),

    // Failed runs in last 24h
    db.select({ count: sql<number>`count(*)` })
      .from(pressScraperRuns)
      .where(and(eq(pressScraperRuns.status, 'err'), gte(pressScraperRuns.startedAt, oneDayAgo))),
  ])

  const total      = Number(totalRows[0]?.count ?? 0)
  const summarised = Number(summarisedRows[0]?.count ?? 0)
  const pending    = Number(unsummarisedRows[0]?.count ?? 0)
  const runs       = Number(runRows[0]?.count ?? 0)
  const failed     = Number(failedRows[0]?.count ?? 0)

  // Source health tally
  const statusMap: Record<string, number> = {}
  for (const row of sourcesRows) statusMap[row.status] = Number(row.count)
  const healthy   = statusMap['healthy']  ?? 0
  const degraded  = statusMap['degraded'] ?? 0
  const down      = statusMap['down']     ?? 0
  const liveCount = healthy + degraded + down
  const trendParts: string[] = []
  if (degraded > 0) trendParts.push(`${degraded} degraded`)
  if (down > 0)     trendParts.push(`${down} down`)

  const coverage = total > 0 ? ((summarised / total) * 100).toFixed(1) : '100'
  const successRate = runs > 0 ? (((runs - failed) / runs) * 100).toFixed(1) : '100'

  return c.json({
    metrics: [
      {
        label: 'Total releases scraped', value: total.toLocaleString(),
        trend: pending > 0 ? `${pending} pending AI` : '',
        trendDir: 'up', foot: 'all time', icon: 'doc',
      },
      {
        label: 'Sources live', value: `${healthy} / ${liveCount}`,
        trend: trendParts.join(', ') || 'all healthy',
        trendDir: degraded + down > 0 ? 'flat' : 'up', foot: 'monitored feeds', icon: 'globe',
      },
      {
        label: 'AI summaries generated', value: summarised.toLocaleString(),
        trend: `${coverage}%`, trendDir: 'up', foot: 'coverage', icon: 'spark',
      },
      {
        label: 'Scrape success rate', value: `${successRate}%`,
        trend: `${failed} fail${failed !== 1 ? 's' : ''} (24h)`,
        trendDir: failed === 0 ? 'up' : 'flat', foot: 'trailing 24h', icon: 'check',
      },
    ],
  })
})

export default router
