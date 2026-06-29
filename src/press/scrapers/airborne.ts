// Airborne Technologies news scraper.
// Server-side rendered HTML — no JS required.
// Listing page: .news-list-item → image, date (.subtitle), title (h2), excerpt (.richtext p)
// Individual article bodies fetched by enrichReleases() via the .richtext selector in runner.ts.
import * as cheerio from 'cheerio'
import type { ScrapedRelease, PressScraperResult } from './types.js'
import { truncate } from './types.js'

const BASE = 'https://www.airbornetechnologies.at'
const LIST_URL = `${BASE}/en/news/`

export async function scrapeAirborne(): Promise<PressScraperResult> {
  try {
    const res = await fetch(LIST_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AviationPress/1.0)',
        Accept: 'text/html',
      },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const $ = cheerio.load(await res.text())
    const releases: ScrapedRelease[] = []

    $('.news-list-item').each((_, el) => {
      const $el = $(el)

      // Link + externalId
      const href = $el.find('.image a').attr('href') ?? $el.find('a.arrow-link').attr('href') ?? ''
      if (!href) return
      const url = href.startsWith('http') ? href : `${BASE}${href}`
      const externalId = href.replace(/\/$/, '').split('/').pop() ?? href

      // Headline
      const headline = $el.find('h2').first().text().trim()
      if (!headline) return

      // Image — article-specific thumbnail from listing (og:image on article pages is generic)
      const imgSrc = $el.find('.image img').attr('src') ?? ''
      const imageUrl = imgSrc ? (imgSrc.startsWith('http') ? imgSrc : `${BASE}${imgSrc}`) : undefined

      // Date — "April 2026" format, use 1st of month
      const dateText = $el.find('.subtitle').first().text().trim()
      const publishedAt = dateText ? new Date(`1 ${dateText}`) : undefined

      // Skip articles with future dates (likely spam or bad data)
      if (publishedAt && !isNaN(publishedAt.getTime()) && publishedAt > new Date()) return

      // Excerpt from listing richtext — preserve paragraph structure
      const paragraphs = $el.find('.richtext p')
        .map((_, p) => $(p).text().replace(/\s+/g, ' ').trim())
        .get()
        .filter(t => t.length > 0)
      const content = paragraphs.length > 0
        ? truncate(paragraphs.join('\n\n'), 800)
        : undefined

      releases.push({
        externalId,
        headline,
        url,
        publishedAt: publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : undefined,
        imageUrl,
        content,
        // fullContent left unset — enrichReleases() fetches the full article body
      })
    })

    if (releases.length === 0) {
      return { releases: [], status: 'warn', itemsCollected: 0, error: 'No items parsed from listing' }
    }

    return { releases, status: 'ok', itemsCollected: releases.length }
  } catch (err) {
    return { releases: [], status: 'err', itemsCollected: 0, error: String(err) }
  }
}
