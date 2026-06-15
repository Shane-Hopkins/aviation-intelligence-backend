// Transport Canada civil aviation press-release scraper.
// Scrapes the TC news releases index page on canada.ca.
import * as cheerio from 'cheerio'
import type { ScrapedRelease, PressScraperResult } from './types.js'
import { truncate } from './types.js'

const BASE = 'https://www.canada.ca'
const LIST_URL = `${BASE}/en/news/advanced-news-search/news-results.html?dprtmnt=departmentoftransport&type=newsReleases`

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

    // canada.ca advanced news search — items are structured as:
    //   <h3><a href="[abs url]">headline</a></h3>
    //   <p>YYYY-MM-DD | Transport Canada | news releases</p>
    //   <p>description</p>
    // No container class; items are separated by <hr>.
    $('h3 > a[href*="transport-canada"]').each((_, el) => {
      const $a = $(el)
      const headline = $a.text().trim()
      if (!headline) return
      if (!AVIATION_RE.test(headline)) return

      const href = $a.attr('href') ?? ''
      const url = href.startsWith('http') ? href : `${BASE}${href}`
      const externalId = href.replace(/\/+$/, '').split('/').pop() ?? headline

      // Next <p> contains "YYYY-MM-DD | dept | type"
      const metaText = $a.closest('h3').next('p').text().trim()
      const dateStr = metaText.split('|')[0].trim()
      const publishedAt = dateStr ? new Date(dateStr) : undefined

      // Second <p> is the blurb
      const blurb = $a.closest('h3').nextAll('p').eq(1).text().trim()

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
