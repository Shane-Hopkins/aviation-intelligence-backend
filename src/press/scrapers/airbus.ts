// Airbus newsroom scraper — scrapes airbus.com/en/newsroom/press-releases.
import * as cheerio from 'cheerio'
import type { ScrapedRelease, PressScraperResult } from './types.js'
import { truncate } from './types.js'

const BASE = 'https://www.airbus.com'
const LIST_URL = `${BASE}/en/newsroom/press-releases`

export async function scrapeAirbus(): Promise<PressScraperResult> {
  try {
    const res = await fetch(LIST_URL, {
      headers: { 'User-Agent': 'AviationPress/1.0', Accept: 'text/html' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const html = await res.text()
    const $ = cheerio.load(html)
    const releases: ScrapedRelease[] = []

    // Airbus uses a Next.js-rendered page; the newsroom listing may have
    // server-rendered article cards with data-* attributes.
    const rowSelectors = [
      'article.news-card',
      '.press-release-item',
      '.newsroom-item',
      '.card--news',
      'li.news-item',
    ]

    let rows = $()
    for (const sel of rowSelectors) {
      rows = $(sel)
      if (rows.length > 0) break
    }

    if (rows.length === 0) {
      // Fallback: any card-style anchor in the main content
      $('a[href*="/newsroom/press-releases/"]').each((_, el) => {
        const $a = $(el)
        const headline = $a.find('h2,h3,h4,[class*="title"]').first().text().trim() || $a.text().trim()
        if (!headline || headline.length < 10) return
        const href = $a.attr('href') ?? ''
        const url = href.startsWith('http') ? href : `${BASE}${href}`
        const dateEl = $a.closest('[class]').find('time, [class*="date"]').first()
        const dateStr = dateEl.attr('datetime') ?? dateEl.text().trim()
        const publishedAt = dateStr ? new Date(dateStr) : undefined
        releases.push({
          externalId: href.replace(/\/+$/, '').split('/').pop() ?? headline,
          headline,
          url,
          publishedAt: publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : undefined,
        })
      })
    } else {
      rows.each((_, el) => {
        const $el = $(el)
        const $link = $el.find('a[href]').first()
        const headline =
          $el.find('h2,h3,h4,[class*="title"]').first().text().trim() ||
          $link.text().trim()
        if (!headline) return

        const href = $link.attr('href') ?? ''
        const url = href.startsWith('http') ? href : `${BASE}${href}`
        const externalId = href.replace(/\/+$/, '').split('/').pop() ?? headline

        const dateStr =
          $el.find('time').attr('datetime') ??
          $el.find('time').text().trim() ??
          $el.find('[class*="date"]').first().text().trim()

        const publishedAt = dateStr ? new Date(dateStr) : undefined
        const blurb = $el.find('p, [class*="body"], [class*="excerpt"]').first().text().trim()

        releases.push({
          externalId,
          headline,
          url,
          publishedAt: publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : undefined,
          content: blurb ? truncate(blurb, 800) : undefined,
        })
      })
    }

    if (releases.length === 0) {
      return { releases: [], status: 'warn', itemsCollected: 0, error: 'No items parsed — selectors may need updating' }
    }

    return { releases, status: 'ok', itemsCollected: releases.length }
  } catch (err) {
    return { releases: [], status: 'err', itemsCollected: 0, error: String(err) }
  }
}
