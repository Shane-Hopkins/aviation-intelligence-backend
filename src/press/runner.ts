// Press-release runner — orchestrates all press scrapers, persists new
// releases to the database, and triggers Claude summarisation.
import * as cheerio from 'cheerio'
import { db } from '../db/client.js'
import { pressSources, pressReleases, pressScraperRuns } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { scrapeFAA } from './scrapers/faa.js'
import { scrapeEASA } from './scrapers/easa.js'
import { scrapeTC } from './scrapers/tc.js'
import { scrapeBoeing } from './scrapers/boeing.js'
import { scrapeAirbus } from './scrapers/airbus.js'
import { scrapeICAO } from './scrapers/icao.js'
import { summariseNewReleases } from './summarize.js'
import type { PressScraperResult, ScrapedRelease } from './scrapers/types.js'
import { sleep } from './scrapers/types.js'

// ---------------------------------------------------------------------------
// Fetch og:image and full article body for a single press release URL.
// Generic — works across FAA, EASA, TC, Boeing, Airbus, ICAO pages.
// ---------------------------------------------------------------------------
async function fetchArticleDetails(url: string): Promise<{ imageUrl?: string; fullContent?: string }> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AviationPress/1.0)',
        Accept: 'text/html',
      },
      signal: AbortSignal.timeout(14_000),
    })
    if (!res.ok) return {}

    const $ = cheerio.load(await res.text())

    // og:image is reliable across all major newsroom platforms
    const imageUrl =
      $('meta[property="og:image"]').attr('content') ||
      $('meta[name="twitter:image"]').attr('content') ||
      $('article img').first().attr('src') ||
      undefined

    // Article body — try semantic selectors in priority order
    const bodyEl = $(
      'article, [role="main"], .press-release-body, .article-body, ' +
      '.release-content, .field--type-text-with-summary, .entry-content, ' +
      '.news-body, .content-body, main'
    ).first()

    const paragraphs = (bodyEl.length ? bodyEl : $('body'))
      .find('p')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(t => t.length > 40) // skip short nav/caption lines

    const fullContent = paragraphs.join('\n\n').slice(0, 8000) || undefined

    return { imageUrl, fullContent }
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------------------
// Enrich scraped releases with article details (og:image + full text).
// Mutates releases in-place. Rate-limited — max 15 fetches per run.
// ---------------------------------------------------------------------------
async function enrichReleases(releases: ScrapedRelease[]): Promise<void> {
  const MAX = 15
  let count = 0
  for (const r of releases) {
    if (!r.url || count >= MAX) break
    const details = await fetchArticleDetails(r.url)
    if (details.imageUrl) r.imageUrl = details.imageUrl
    // Only overwrite fullContent if we didn't already have a meaningful blurb
    if (details.fullContent && (!r.content || r.content.length < 300)) {
      r.fullContent = details.fullContent
    } else if (details.fullContent) {
      r.fullContent = details.fullContent
    }
    count++
    await sleep(300) // polite crawl rate
  }
}

// ---------------------------------------------------------------------------
// Route each source to its scraper module
// ---------------------------------------------------------------------------
async function runScraper(scraperType: string): Promise<PressScraperResult> {
  switch (scraperType) {
    case 'faa':    return scrapeFAA()
    case 'easa':   return scrapeEASA()
    case 'tc':     return scrapeTC()
    case 'boeing': return scrapeBoeing()
    case 'airbus': return scrapeAirbus()
    case 'icao':   return scrapeICAO()
    default:
      return { releases: [], status: 'err', itemsCollected: 0, error: `Unknown scraper type: ${scraperType}` }
  }
}

// ---------------------------------------------------------------------------
// Persist new releases — returns IDs of rows actually inserted
// ---------------------------------------------------------------------------
async function persistReleases(sourceId: number, result: PressScraperResult): Promise<number[]> {
  const newIds: number[] = []
  for (const r of result.releases) {
    try {
      const inserted = await db
        .insert(pressReleases)
        .values({
          sourceId,
          externalId: r.externalId,
          docRef: r.docRef ?? null,
          headline: r.headline,
          url: r.url ?? null,
          publishedAt: r.publishedAt ?? null,
          content: r.content ?? null,
          imageUrl: r.imageUrl ?? null,
          fullContent: r.fullContent ?? null,
        })
        .onConflictDoNothing()
        .returning({ id: pressReleases.id })

      if (inserted.length > 0) newIds.push(inserted[0].id)
    } catch {
      // Single insert failure shouldn't stop the run
    }
  }
  return newIds
}

// ---------------------------------------------------------------------------
// Update source health status based on result
// ---------------------------------------------------------------------------
async function updateSourceStatus(sourceId: number, result: PressScraperResult): Promise<void> {
  const status =
    result.status === 'ok'   ? 'healthy'  :
    result.status === 'warn' ? 'degraded' : 'down'
  await db.update(pressSources).set({ status }).where(eq(pressSources.id, sourceId))
}

// ---------------------------------------------------------------------------
// Run a single press source end-to-end
// ---------------------------------------------------------------------------
export async function runPressSource(sourceId: number): Promise<void> {
  const [run] = await db
    .insert(pressScraperRuns)
    .values({ sourceId })
    .returning({ id: pressScraperRuns.id })

  const source = await db.query.pressSources.findFirst({
    where: eq(pressSources.id, sourceId),
  })

  if (!source) {
    await db
      .update(pressScraperRuns)
      .set({ status: 'err', error: 'Source not found', completedAt: new Date() })
      .where(eq(pressScraperRuns.id, run.id))
    return
  }

  console.log(`[press] Starting: ${source.name}`)

  let result: PressScraperResult
  try {
    result = await runScraper(source.scraperType)
  } catch (err) {
    result = { releases: [], status: 'err', itemsCollected: 0, error: String(err) }
  }

  // Enrich each release with og:image and full article text
  if (result.releases.length > 0) {
    console.log(`[press] Enriching up to 15 articles for ${source.name}…`)
    await enrichReleases(result.releases)
  }

  const newIds = await persistReleases(sourceId, result)
  console.log(`[press] ${source.name}: ${result.releases.length} scraped, ${newIds.length} new`)

  await db
    .update(pressScraperRuns)
    .set({
      status: result.status,
      itemsCollected: newIds.length,
      error: result.error ?? null,
      completedAt: new Date(),
    })
    .where(eq(pressScraperRuns.id, run.id))

  await updateSourceStatus(sourceId, result)

  // Trigger AI summarisation for new releases
  if (newIds.length > 0) {
    const sourceNameById = new Map([[sourceId, source.name]])
    await summariseNewReleases(newIds, sourceNameById)
  }
}

// ---------------------------------------------------------------------------
// Run all enabled press sources sequentially
// ---------------------------------------------------------------------------
export async function runAllPressSources(): Promise<void> {
  const sources = await db.query.pressSources.findMany({
    where: eq(pressSources.enabled, true),
  })

  console.log(`[press] Running ${sources.length} press scrapers…`)

  for (const source of sources) {
    try {
      await runPressSource(source.id)
    } catch (err) {
      console.error(`[press] Fatal error on ${source.name}:`, err)
    }
  }

  console.log('[press] All done.')
}

// Allow direct execution: tsx src/press/runner.ts
if (process.argv[1]?.endsWith('runner.ts') || process.argv[1]?.endsWith('runner.js')) {
  runAllPressSources().catch(console.error).finally(() => process.exit(0))
}
