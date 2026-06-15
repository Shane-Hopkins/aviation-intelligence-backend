// Transport Canada civil aviation press-release scraper.
// Scrapes the TC news releases index page on canada.ca.
import * as cheerio from 'cheerio'
import type { ScrapedRelease, PressScraperResult } from './types.js'
import { truncate } from './types.js'

const BASE = 'https://tc.canada.ca'
const LIST_URL = `${BASE}/en/corporate-services/news-communications/news-releases`

// Try to detect aviation-relevant releases by headline keywords
const AVIATION_RE =
  /\b(aviation|airworthiness|aircraft|aerodrome|runway|airspace|drone|uas|uav|helicopter|pilot|airline|airport|transport canada civil|tc civil)\b/i

export async function scrapeTC(): Promise<PressScraperResult> {
  try {
    const res = await fetch(LIST_URL, {
      headers: { 'User-Agent': 'AviationPress/1.0', Accept: 'text/html' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const html = await res.text()
    const $ = cheerio.load(html)
    const releases: ScrapedRelease[] = []

    // Canada.ca WET theme — news listing uses various container classes
    const rowSelectors = [
      '.news-list li',
      '.media-list li',
      'ul.list-group li',
      '.gc-docs li',
      'article',
    ]

    let rows = $()
    for (const sel of rowSelectors) {
      rows = $(sel)
      if (rows.length > 0) break
    }

    // Fallback: any anchor inside main content area
    if (rows.length === 0) {
      rows = $('main a[href]').closest('li,article,div.item')
    }

    rows.each((_, el) => {
      const $el = $(el)
      const $link = $el.find('a[href]').first()
      const headline = $link.text().trim()
      if (!headline) return
      if (!AVIATION_RE.test(headline)) return

      const href = $link.attr('href') ?? ''
      const url = href.startsWith('http') ? href : `${BASE}${href}`
      const externalId = href.replace(/\/+$/, '').split('/').pop() ?? headline

      const dateStr =
        $el.find('time').attr('datetime') ??
        $el.find('time').text().trim() ??
        $el.find('.date, .news-date, .mrgn-bttm-sm').first().text().trim()

      const publishedAt = dateStr ? new Date(dateStr) : undefined
      const blurb = $el.find('p').first().text().trim()

      releases.push({
        externalId,
        headline,
        url,
        publishedAt: publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : undefined,
        content: blurb ? truncate(blurb, 800) : undefined,
      })
    })

    if (releases.length === 0) {
      return { releases: [], status: 'warn', itemsCollected: 0, error: 'No aviation items found — selectors may need updating' }
    }

    return { releases, status: 'ok', itemsCollected: releases.length }
  } catch (err) {
    return { releases: [], status: 'err', itemsCollected: 0, error: String(err) }
  }
}
