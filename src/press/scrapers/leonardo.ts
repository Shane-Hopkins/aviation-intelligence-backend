// Leonardo Helicopters press-release scraper.
// Listing: https://helicopters.leonardo.com/en/media-hub/press-releases
// Articles live on www.leonardo.com (Liferay CMS, og:image present).
// imageUrl / fullContent left unset — enrichReleases fetches article pages.
import * as cheerio from 'cheerio'
import type { ScrapedRelease, PressScraperResult } from './types.js'

const LIST_URL = 'https://helicopters.leonardo.com/en/media-hub/press-releases'
const LIST_BASE = 'https://helicopters.leonardo.com'

export async function scrapeLeonardo(): Promise<PressScraperResult> {
  try {
    const res = await fetch(LIST_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AviationPress/1.0)', Accept: 'text/html' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const $ = cheerio.load(await res.text())
    const releases: ScrapedRelease[] = []
    const seen = new Set<string>()

    // Press release cards have .body-small for the headline.
    // Simple "link-list" items on the page lack this — skip them.
    $('a[href*="press-release-detail"]').each((_, el) => {
      const headline = $(el).find('.body-small').text().trim()
      if (!headline) return

      const href = $(el).attr('href') ?? ''
      if (!href) return

      const slugMatch = href.match(/\/detail\/([^/?#]+)/)
      const externalId = slugMatch?.[1]
      if (!externalId || seen.has(externalId)) return
      seen.add(externalId)

      const url = href.startsWith('http') ? href : `${LIST_BASE}${href}`

      // Date: "15.06.2026 - 15:45" → parse DD.MM.YYYY
      const dateText = $(el).find('.label-light').text().trim()
      const datePart = dateText.split(' - ')[0]
      const [day, month, year] = datePart.split('.')
      const publishedAt = day && month && year ? new Date(`${year}-${month}-${day}`) : undefined

      releases.push({ externalId, headline, url, publishedAt })
    })

    if (releases.length === 0) {
      return { releases: [], status: 'warn', itemsCollected: 0, error: 'No press releases found' }
    }

    return { releases, status: 'ok', itemsCollected: releases.length }
  } catch (err) {
    return { releases: [], status: 'err', itemsCollected: 0, error: String(err) }
  }
}
