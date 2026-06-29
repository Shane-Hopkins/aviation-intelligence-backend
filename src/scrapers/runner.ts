// Scraper runner — orchestrates all forum scrapers, deduplicates posts,
// persists to the database, and triggers analysis after each run.
import { db } from '../db/client.js'
import { forums, posts, scraperRuns } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { scrapeReddit } from './reddit.js'
import { scrapePPRuNe } from './pprune.js'
import { analyseNewPosts } from '../analysis/sentiment.js'
import { rebuildTopics } from '../analysis/topics.js'
import type { ScraperResult, ScrapedPost } from './types.js'

// ---------------------------------------------------------------------------
// Route scraped posts through the correct scraper module
// ---------------------------------------------------------------------------
async function runScraper(
  scraperType: string,
  scraperConfig: Record<string, unknown>,
): Promise<ScraperResult> {
  switch (scraperType) {
    case 'reddit': {
      const subreddit = scraperConfig.subreddit as string
      return scrapeReddit(subreddit)
    }
    case 'pprune': {
      const paths = (scraperConfig.sectionPaths as string[]) ?? ['/rumours-news/']
      return scrapePPRuNe(paths)
    }
    default:
      return { posts: [], status: 'err', itemsCollected: 0, error: `Unknown scraper type: ${scraperType}` }
  }
}

// ---------------------------------------------------------------------------
// Persist new posts — returns the IDs of posts that were actually inserted
// (skipping duplicates that already exist in the DB).
// ---------------------------------------------------------------------------
async function persistPosts(
  forumId: number,
  scraped: ScrapedPost[],
): Promise<number[]> {
  const newIds: number[] = []

  for (const p of scraped) {
    try {
      const inserted = await db
        .insert(posts)
        .values({
          forumId,
          externalId: p.externalId,
          threadId: p.threadId,
          threadTitle: p.threadTitle,
          content: p.content,
          author: p.author ?? 'unknown',
          url: p.url,
          postedAt: p.postedAt,
        })
        .onConflictDoNothing()
        .returning({ id: posts.id })

      if (inserted.length > 0) {
        newIds.push(inserted[0].id)
      }
    } catch {
      // Individual post insert failure shouldn't stop the run
    }
  }

  return newIds
}

// ---------------------------------------------------------------------------
// Update forum status based on scraper result
// ---------------------------------------------------------------------------
async function updateForumStatus(
  forumId: number,
  result: ScraperResult,
): Promise<void> {
  const status =
    result.status === 'ok'
      ? 'healthy'
      : result.status === 'warn'
        ? 'degraded'
        : 'down'

  await db.update(forums).set({ status }).where(eq(forums.id, forumId))
}

// ---------------------------------------------------------------------------
// Run a single forum scraper end-to-end
// ---------------------------------------------------------------------------
export async function runForumScraper(forumId: number): Promise<void> {
  // Create run record
  const [run] = await db
    .insert(scraperRuns)
    .values({ forumId })
    .returning({ id: scraperRuns.id })

  const forum = await db.query.forums.findFirst({
    where: eq(forums.id, forumId),
  })

  if (!forum) {
    await db
      .update(scraperRuns)
      .set({ status: 'err', error: 'Forum not found', completedAt: new Date() })
      .where(eq(scraperRuns.id, run.id))
    return
  }

  console.log(`[scraper] Starting: ${forum.name}`)
  let config: Record<string, unknown> = {}
  try {
    config = forum.scraperConfig ? JSON.parse(forum.scraperConfig) : {}
  } catch {
    config = {}
  }

  let result: ScraperResult
  try {
    result = await runScraper(forum.scraperType, config)
  } catch (err) {
    result = { posts: [], status: 'err', itemsCollected: 0, error: String(err) }
  }

  // Persist new posts
  const newPostIds = await persistPosts(forumId, result.posts)
  console.log(`[scraper] ${forum.name}: ${result.posts.length} scraped, ${newPostIds.length} new`)

  // Update run record
  await db
    .update(scraperRuns)
    .set({
      status: result.status,
      itemsCollected: newPostIds.length,
      error: result.error ?? null,
      completedAt: new Date(),
    })
    .where(eq(scraperRuns.id, run.id))

  // Update forum health status
  await updateForumStatus(forumId, result)

  // Run sentiment analysis on new posts
  if (newPostIds.length > 0) {
    console.log(`[analysis] Analysing ${newPostIds.length} new posts from ${forum.name}…`)
    await analyseNewPosts(newPostIds)
  }
}

// ---------------------------------------------------------------------------
// Run all enabled forum scrapers sequentially, then rebuild topics
// ---------------------------------------------------------------------------
export async function runAllScrapers(): Promise<void> {
  const enabledForums = await db.query.forums.findMany({
    where: eq(forums.enabled, true),
  })

  console.log(`[scraper] Running ${enabledForums.length} forum scrapers…`)

  for (const forum of enabledForums) {
    try {
      await runForumScraper(forum.id)
    } catch (err) {
      console.error(`[scraper] Fatal error on ${forum.name}:`, err)
    }
  }

  // After all scrapers complete, rebuild aggregated topics
  console.log('[analysis] Rebuilding topics…')
  await rebuildTopics()
  console.log('[scraper] All done.')
}

// Allow running directly: tsx src/scrapers/runner.ts
if (process.argv[1]?.endsWith('runner.ts') || process.argv[1]?.endsWith('runner.js')) {
  runAllScrapers().catch(console.error).finally(() => process.exit(0))
}
