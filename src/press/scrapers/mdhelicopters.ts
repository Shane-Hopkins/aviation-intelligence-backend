// MD Helicopters press-release scraper.
// Listing: https://www.mdhelicopters.com/category/press-releases/
// WordPress site — no dates in listing, fetched from article:published_time by enrichReleases.
// Images: .wp-post-image with data-lazy-src fallback for lazy-loaded items.
import * as cheerio from 'cheerio'
import type { ScrapedRelease, PressScraperResult } from './types.js'

const LIST_URL = 'https://www.mdhelicopters.com/category/press-releases/'

export async function scrapeMDHelicopters(): Promise<PressScraperResult> {
  try {
    const res = await fetch(LIST_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AviationPress/1.0)', Accept: 'text/html' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const $ = cheerio.load(await res.text())
    const releases: ScrapedRelease[] = []
    const seen = new Set<string>()

    $('article.post').each((_, el) => {
      const a = $(el).find('h2.entry-title a').first()
      const headline = a.text().trim()
      const url = a.attr('href') ?? ''
      if (!headline || !url) return

      // externalId from URL slug (last non-empty path segment)
      const slug = url.replace(/\/$/, '').split('/').pop()
      if (!slug || seen.has(slug)) return
      seen.add(slug)

      // imageUrl and publishedAt left unset — enrichReleases fetches article pages for
      // og:image (full-size, no size suffix) and article:published_time.
      releases.push({ externalId: slug, headline, url })
    })

    if (releases.length === 0) {
      return { releases: [], status: 'warn', itemsCollected: 0, error: 'No press releases found' }
    }

    return { releases, status: 'ok', itemsCollected: releases.length }
  } catch (err) {
    return { releases: [], status: 'err', itemsCollected: 0, error: String(err) }
  }
}
