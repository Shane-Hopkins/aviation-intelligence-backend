// ICAO newsroom scraper — scrapes the ICAO newsroom index.
// ICAO uses SharePoint Online; the news list is server-rendered.
import * as cheerio from 'cheerio'
import type { ScrapedRelease, PressScraperResult } from './types.js'
import { truncate } from './types.js'

const BASE = 'https://www.icao.int'
const LIST_URL = `${BASE}/Newsroom/Pages/default.aspx`

export async function scrapeICAO(): Promise<PressScraperResult> {
  try {
    const res = await fetch(LIST_URL, {
      headers: { 'User-Agent': 'AviationPress/1.0', Accept: 'text/html' },
      signal: AbortSignal.timeout(25_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const html = await res.text()
    const $ = cheerio.load(html)
    const releases: ScrapedRelease[] = []
    const seen = new Set<string>()

    // ICAO newsroom is now Drupal — articles are all at /news/{slug}
    $('a[href^="/news/"]').each((_, el) => {
      const $a = $(el)
      const href = $a.attr('href') ?? ''
      if (!href || seen.has(href)) return
      seen.add(href)

      // The visible text of the link is the headline; skip nav/sidebar short links
      const headline = $a.text().replace(/\s+/g, ' ').trim()
      if (!headline || headline.length < 20) return

      const url = `${BASE}${href}`
      const externalId = href.replace(/\/+$/, '').split('/').pop() ?? href

      // Try to find a date in the nearest list/article ancestor
      const $ancestor = $a.closest('li, article, .views-row, .card')
      const dateStr =
        $ancestor.find('time').first().attr('datetime') ??
        $ancestor.find('[class*="date"]').first().text().trim()
      const publishedAt = dateStr ? new Date(dateStr) : undefined

      releases.push({
        externalId,
        headline,
        url,
        publishedAt: publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : undefined,
      })
    })

    if (releases.length === 0) {
      return { releases: [], status: 'warn', itemsCollected: 0, error: 'No /news/ links found — page structure may have changed' }
    }

    return { releases, status: 'ok', itemsCollected: releases.length }
  } catch (err) {
    return { releases: [], status: 'err', itemsCollected: 0, error: String(err) }
  }
}
