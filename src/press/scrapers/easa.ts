// EASA press-release scraper — scrapes the EASA newsroom listing page.
import * as cheerio from 'cheerio'
import type { ScrapedRelease, PressScraperResult } from './types.js'
import { truncate } from './types.js'

const BASE = 'https://www.easa.europa.eu'
const LIST_URL = `${BASE}/en/newsroom-and-events/press-releases`

export async function scrapeEASA(): Promise<PressScraperResult> {
  try {
    const res = await fetch(LIST_URL, {
      headers: { 'User-Agent': 'AviationPress/1.0', Accept: 'text/html' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const html = await res.text()
    const $ = cheerio.load(html)
    const releases: ScrapedRelease[] = []

    // EASA uses Drupal — try several known selectors in priority order
    const rowSelectors = [
      '.view-press-releases .views-row',
      '.news-list__item',
      'article.node--type-press-release',
      '.teaser',
    ]

    let rows = $()
    for (const sel of rowSelectors) {
      rows = $(sel)
      if (rows.length > 0) break
    }

    rows.each((_, el) => {
      const $el = $(el)

      // Headline + URL
      const $link = $el.find('a[href]').first()
      const headline = $link.text().trim() || $el.find('h2,h3,h4').first().text().trim()
      const href = $link.attr('href') ?? ''
      if (!headline) return

      const url = href.startsWith('http') ? href : `${BASE}${href}`
      const externalId = href.replace(/\/+$/, '').split('/').pop() ?? headline

      // Date — look for <time> or common date containers
      const dateStr =
        $el.find('time').attr('datetime') ??
        $el.find('time').text().trim() ??
        $el.find('.date, .field--name-field-date, .news-date').first().text().trim()

      const publishedAt = dateStr ? new Date(dateStr) : undefined

      // Blurb
      const blurb = $el.find('p, .teaser__body, .field--name-body').first().text().trim()

      releases.push({
        externalId,
        headline,
        url,
        publishedAt: publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : undefined,
        content: blurb ? truncate(blurb, 800) : undefined,
      })
    })

    if (releases.length === 0) {
      return { releases: [], status: 'warn', itemsCollected: 0, error: 'No items parsed — selectors may need updating' }
    }

    return { releases, status: 'ok', itemsCollected: releases.length }
  } catch (err) {
    return { releases: [], status: 'err', itemsCollected: 0, error: String(err) }
  }
}
