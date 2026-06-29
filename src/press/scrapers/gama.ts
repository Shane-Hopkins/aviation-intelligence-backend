// GAMA (General Aviation Manufacturers Association) press releases scraper.
// Listing: https://gama.aero/news-and-events/press-releases/
// RSS feed requires auth — scrape HTML listing instead.
// Article body is in .entry-content — handled by enrichReleases in runner.ts.
import * as cheerio from 'cheerio'
import type { ScrapedRelease, PressScraperResult } from './types.js'

const LIST_URL = 'https://gama.aero/news-and-events/press-releases/'
const MAX_RELEASES = 25

export async function scrapeGAMA(): Promise<PressScraperResult> {
  try {
    const res = await fetch(LIST_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AviationPress/1.0)', Accept: 'text/html' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const $ = cheerio.load(await res.text())
    const releases: ScrapedRelease[] = []

    $('article.box').each((_, el) => {
      const $el = $(el)
      const $a   = $el.find('.box-title a').first()
      const url  = $a.attr('href')?.trim()
      const headline = $a.text().trim()
      if (!url || !headline) return

      const dateText = $el.find('.box-date').text().trim()
      const publishedAt = dateText ? new Date(dateText) : undefined

      const excerpt = $el.find('.box-content p').text().replace(/\s+/g, ' ').trim()
      const externalId = url.replace(/\/$/, '').split('/').pop() ?? url

      releases.push({
        externalId,
        headline,
        url,
        publishedAt: publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : undefined,
        content: excerpt || undefined,
        // imageUrl and fullContent intentionally omitted — enrichReleases fetches
        // og:image (GAMA logo) and article body from .entry-content
      })
    })

    if (releases.length === 0) {
      return { releases: [], status: 'warn', itemsCollected: 0, error: 'No article.box elements found' }
    }

    return { releases: releases.slice(0, MAX_RELEASES), status: 'ok', itemsCollected: Math.min(releases.length, MAX_RELEASES) }
  } catch (err) {
    return { releases: [], status: 'err', itemsCollected: 0, error: String(err) }
  }
}
