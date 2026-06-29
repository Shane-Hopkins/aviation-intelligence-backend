// Metro Aviation news scraper.
// Listing: https://www.metroaviation.com/metro-media/
// Divi theme WordPress site. Date is embedded in the article URL path (/YYYY/MM/DD/).
// og:image and article body (.entry-content) fetched by enrichReleases.
import * as cheerio from 'cheerio'
import type { ScrapedRelease, PressScraperResult } from './types.js'

const LIST_URL = 'https://www.metroaviation.com/metro-media/'

export async function scrapeMetroAviation(): Promise<PressScraperResult> {
  try {
    const res = await fetch(LIST_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AviationPress/1.0)', Accept: 'text/html' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const $ = cheerio.load(await res.text())
    const releases: ScrapedRelease[] = []
    const seen = new Set<string>()

    // Divi blog posts — skip the page-level <article> (no entry-title link)
    $('article.et_pb_post').each((_, el) => {
      const a = $(el).find('h2.entry-title a').first()
      const headline = a.text().trim()
      const url = a.attr('href') ?? ''
      if (!headline || !url) return

      // externalId from WordPress post ID on the article element
      const idAttr = $(el).attr('id') ?? ''           // e.g. "post-255068"
      const externalId = idAttr.replace('post-', '') || (url.replace(/\/$/, '').split('/').pop() ?? '')
      if (!externalId || seen.has(externalId)) return
      seen.add(externalId)

      // Date from URL path: /YYYY/MM/DD/
      const dateMatch = url.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//)
      const publishedAt = dateMatch
        ? new Date(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`)
        : undefined

      // imageUrl and fullContent deferred to enrichReleases (og:image + .entry-content)
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
