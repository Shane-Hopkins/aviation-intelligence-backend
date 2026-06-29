// Omni Helicopters International press release scraper.
// Listing: https://www.omnihelicoptersinternational.com/all-news/?category=press-release
// Paginated: follows next-page links up to MAX_PAGES
// Each article element: h3 (headline), a.img (URL), img.attachment-posts (thumbnail),
//   link text "March 5, 2026 | In the News | Press Release" (date)
// Article body: .e-content — added to runner.ts body selectors
// publishedAt: from article:published_time via enrichReleases
import * as cheerio from 'cheerio'
import type { ScrapedRelease, PressScraperResult } from './types.js'
import { sleep } from './types.js'

const BASE_URL = 'https://www.omnihelicoptersinternational.com'
const LIST_URL = `${BASE_URL}/all-news/?category=press-release`
const MAX_PAGES = 5

export async function scrapeOmniHelicopters(): Promise<PressScraperResult> {
  try {
    const releases: ScrapedRelease[] = []
    const seen = new Set<string>()
    let nextUrl: string | undefined = LIST_URL

    for (let page = 1; page <= MAX_PAGES && nextUrl; page++) {
      const res = await fetch(nextUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AviationPress/1.0)', Accept: 'text/html' },
        signal: AbortSignal.timeout(20_000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status} on ${nextUrl}`)

      const $ = cheerio.load(await res.text())

      $('article').each((_, el) => {
        const headline = $(el).find('h3').first().text().trim()
        const url = $(el).find('a.img').first().attr('href') ?? ''
        if (!headline || !url) return

        const externalId = url.replace(/\/$/, '').split('/').pop() ?? ''
        if (!externalId || seen.has(externalId)) return
        seen.add(externalId)

        // Thumbnail from listing card
        const imgSrc = $(el).find('img.attachment-posts').first().attr('src')
        const imageUrl = imgSrc || undefined

        // Date from the meta-link text: "March 5, 2026 | In the News | Press Release"
        const metaText = $(el).find('a').filter((_, a) => /\d{4}/.test($(a).text())).first().text().trim()
        const datePart = metaText.split('|')[0].trim()
        const publishedAt = datePart ? new Date(datePart) : undefined

        releases.push({ externalId, headline, url, publishedAt, imageUrl })
      })

      // Follow pagination
      const nextLink = $('a[href*="/page/"]').filter((_, a) => $(a).text().trim().toLowerCase().includes('next')).first().attr('href')
      nextUrl = nextLink || undefined

      if (nextUrl && page < MAX_PAGES) await sleep(500)
    }

    if (releases.length === 0) {
      return { releases: [], status: 'warn', itemsCollected: 0, error: 'No press releases found' }
    }

    return { releases, status: 'ok', itemsCollected: releases.length }
  } catch (err) {
    return { releases: [], status: 'err', itemsCollected: 0, error: String(err) }
  }
}
