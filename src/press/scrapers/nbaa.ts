// NBAA press release scraper.
// Listing: https://nbaa.org/press-releases/
// Accordion grouped by year: .panel-group.post-archive-list-accordion → .panel → li
// Each li: a.event-title (headline + URL), plain text date ("June 23, 2026"), .teaser p (snippet)
// Article body: .entry-content — handled by enrichReleases
// No article-specific images (og:image is a generic site image)
// publishedAt: from article:published_time meta via fetchArticleDetails
import * as cheerio from 'cheerio'
import type { ScrapedRelease, PressScraperResult } from './types.js'

const LIST_URL = 'https://nbaa.org/press-releases/'
const MIN_YEAR = 2024

export async function scrapeNBAA(): Promise<PressScraperResult> {
  try {
    const res = await fetch(LIST_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AviationPress/1.0)', Accept: 'text/html' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const $ = cheerio.load(await res.text())
    const releases: ScrapedRelease[] = []
    const seen = new Set<string>()

    $('.panel-group.post-archive-list-accordion .panel').each((_, panel) => {
      // Year heading
      const yearText = $(panel).find('.panel-heading a').first().text().trim()
      const year = parseInt(yearText)
      if (!year || year < MIN_YEAR) return

      $(panel).find('.panel-body li').each((_, li) => {
        const a = $(li).find('a.event-title').first()
        const headline = a.text().trim()
        const url = a.attr('href') ?? ''
        if (!headline || !url) return

        // externalId from URL slug
        const externalId = url.replace(/\/$/, '').split('/').pop() ?? ''
        if (!externalId || seen.has(externalId)) return
        seen.add(externalId)

        // Date is a plain text node between the link and .teaser: "June 23, 2026"
        const dateText = $(li).clone().find('a, .teaser').remove().end().text().trim()
        const publishedAt = dateText ? new Date(dateText) : undefined

        releases.push({ externalId, headline, url, publishedAt })
      })
    })

    if (releases.length === 0) {
      return { releases: [], status: 'warn', itemsCollected: 0, error: 'No press releases found' }
    }

    return { releases, status: 'ok', itemsCollected: releases.length }
  } catch (err) {
    return { releases: [], status: 'err', itemsCollected: 0, error: String(err) }
  }
}
