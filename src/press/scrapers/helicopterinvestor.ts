// Helicopter Investor news scraper.
// Listing: https://www.helicopterinvestor.com/news/
// Each article card has a lazy-loaded thumbnail in data-src (or <noscript> fallback).
// fullContent intentionally omitted — enrichReleases fetches article body.
import * as cheerio from 'cheerio'
import type { ScrapedRelease, PressScraperResult } from './types.js'

const LIST_URL = 'https://www.helicopterinvestor.com/news/'
const MAX_RELEASES = 25

export async function scrapeHelicopterInvestor(): Promise<PressScraperResult> {
  try {
    const res = await fetch(LIST_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AviationPress/1.0)', Accept: 'text/html' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const $ = cheerio.load(await res.text())
    const releases: ScrapedRelease[] = []

    $('article[id^="post-"]').each((_, el) => {
      const $el = $(el)

      // Post ID from the element's id attribute, e.g. id="post-105461"
      const rawId = $el.attr('id') ?? ''
      const externalId = rawId.replace('post-', '') || rawId

      // Title and URL from the h3 link
      const $a = $el.find('h3 a, h2 a').first()
      const headline = $a.text().trim()
      const url = $a.attr('href')?.trim()
      if (!headline || !url || !externalId) return

      // Grab listing thumbnail as fallback imageUrl — enrichReleases will override
      // with the higher-res og:image from the article page when available.
      // HI uses lazy-loading: src is a base64 placeholder, real URL is in data-src.
      const rawSrc = $el.find('img').first().attr('data-src')?.trim() || $el.find('img').first().attr('src')?.trim()
      const imageUrl = rawSrc && !rawSrc.startsWith('data:') ? rawSrc : undefined

      // Date from <time> element, e.g. "18 Jun 26"
      let publishedAt: Date | undefined
      const timeText = $el.find('time').text().trim()
      if (timeText) {
        // "18 Jun 26" → prepend "20" for 2-digit year
        const normalized = timeText.replace(/\b(\d{2})$/, '20$1')
        const d = new Date(normalized)
        if (!isNaN(d.getTime())) publishedAt = d
      }

      releases.push({ externalId, headline, url, publishedAt, imageUrl })
    })

    if (releases.length === 0) {
      return { releases: [], status: 'warn', itemsCollected: 0, error: 'No article elements found' }
    }

    return { releases: releases.slice(0, MAX_RELEASES), status: 'ok', itemsCollected: Math.min(releases.length, MAX_RELEASES) }
  } catch (err) {
    return { releases: [], status: 'err', itemsCollected: 0, error: String(err) }
  }
}
