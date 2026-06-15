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

    // SharePoint-based page with news tiles
    const rowSelectors = [
      '.ms-rtestate-field .link-item',
      '.NewsItems li',
      'div[class*="news"] a',
      '.ms-srch-item',
      'td.ms-vb2',
    ]

    for (const sel of rowSelectors) {
      $(sel).each((_, el) => {
        const $el = $(el)
        const $link = $el.is('a') ? $el : $el.find('a[href]').first()
        const headline = $link.text().trim() || $el.text().trim()
        if (!headline || headline.length < 10) return

        const href = $link.attr('href') ?? ''
        if (!href) return

        const url = href.startsWith('http') ? href : `${BASE}${href}`
        const externalId = href.replace(/\/+$/, '').split('/').pop() ?? headline

        const dateStr =
          $el.find('time').attr('datetime') ??
          $el.find('[class*="date"]').first().text().trim() ??
          $el.closest('tr').find('td').eq(1).text().trim()

        const publishedAt = dateStr ? new Date(dateStr) : undefined
        const blurb = $el.find('p,[class*="desc"]').first().text().trim()

        releases.push({
          externalId,
          headline,
          url,
          publishedAt: publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : undefined,
          content: blurb ? truncate(blurb, 800) : undefined,
        })
      })
      if (releases.length > 0) break
    }

    // Generic fallback for any anchor in page content
    if (releases.length === 0) {
      $('a[href*="/Newsroom/"], a[href*="/newsroom/"]').each((_, el) => {
        const $a = $(el)
        const headline = $a.text().trim()
        if (!headline || headline.length < 15) return
        const href = $a.attr('href') ?? ''
        const url = href.startsWith('http') ? href : `${BASE}${href}`
        releases.push({
          externalId: href.replace(/\/+$/, '').split('/').pop() ?? headline,
          headline,
          url,
        })
      })
    }

    if (releases.length === 0) {
      return { releases: [], status: 'warn', itemsCollected: 0, error: 'No items parsed — SharePoint selectors may need updating' }
    }

    return { releases, status: 'ok', itemsCollected: releases.length }
  } catch (err) {
    return { releases: [], status: 'err', itemsCollected: 0, error: String(err) }
  }
}
