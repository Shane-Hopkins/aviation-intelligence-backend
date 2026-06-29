// Milestone Aviation press release scraper.
// Listing: https://www.milestoneaviation.com/media-center/press-releases
// Each article.content has: h3 (headline), time[datetime] (ISO date), a[href*="detail"] (relative URL)
// Article body: article.full-news-article — falls through to generic `article` fallback in enrichReleases
// og:image is site-level social image (not article-specific) — imageUrl left to enrichReleases
import * as cheerio from 'cheerio'
import type { ScrapedRelease, PressScraperResult } from './types.js'

const LIST_URL = 'https://www.milestoneaviation.com/media-center/press-releases'

export async function scrapeMilestoneAviation(): Promise<PressScraperResult> {
  try {
    const res = await fetch(LIST_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AviationPress/1.0)', Accept: 'text/html' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const $ = cheerio.load(await res.text())
    const releases: ScrapedRelease[] = []
    const seen = new Set<string>()

    $('article.content').each((_, el) => {
      const headline = $(el).find('h3').first().text().trim()
      const href = $(el).find('a[href*="detail"]').first().attr('href') ?? ''
      if (!headline || !href) return

      // Resolve relative URL: ./press-releases/detail/ID/slug → full URL
      const url = new URL(href, LIST_URL).href

      // externalId: numeric ID from /detail/10000/slug
      const idMatch = url.match(/\/detail\/(\d+)\//)
      const externalId = idMatch ? idMatch[1] : url.split('/').filter(Boolean).pop() ?? ''
      if (!externalId || seen.has(externalId)) return
      seen.add(externalId)

      // Date from time[datetime] ISO attribute
      const datetime = $(el).find('time[datetime]').first().attr('datetime')
      const publishedAt = datetime ? new Date(datetime) : undefined

      // Thumbnail from listing card — img.content-image has a direct src URL
      const imageUrl = $(el).find('img.content-image').first().attr('src') || undefined

      releases.push({ externalId, headline, url, publishedAt, imageUrl })
    })

    if (releases.length === 0) {
      return { releases: [], status: 'warn', itemsCollected: 0, error: 'No press releases found' }
    }

    return { releases, status: 'ok', itemsCollected: releases.length }
  } catch (err) {
    return { releases: [], status: 'err', itemsCollected: 0, error: String(err) }
  }
}
