// Boeing newsroom scraper — scrapes boeing.mediaroom.com.
import * as cheerio from 'cheerio'
import type { ScrapedRelease, PressScraperResult } from './types.js'
import { truncate } from './types.js'

const BASE = 'https://boeing.mediaroom.com'
const LIST_URL = `${BASE}/news-releases-statements`

export async function scrapeBoeing(): Promise<PressScraperResult> {
  try {
    const res = await fetch(LIST_URL, {
      headers: { 'User-Agent': 'AviationPress/1.0', Accept: 'text/html' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const html = await res.text()
    const $ = cheerio.load(html)
    const releases: ScrapedRelease[] = []

    // PR Newswire / Business Wire style templates used by large OEMs
    const rowSelectors = [
      '.press-releases-list li',
      '.newsList li',
      '.rss-item',
      'ul.news-list li',
      '.prn_item',
      'article.news',
    ]

    let rows = $()
    for (const sel of rowSelectors) {
      rows = $(sel)
      if (rows.length > 0) break
    }

    if (rows.length === 0) {
      // Generic fallback: anchors in main content
      $('main a[href*="/news"], a[href*="/press-release"], a[href*="/statement"]').each((_, el) => {
        const $a = $(el)
        const headline = $a.text().trim()
        if (!headline || headline.length < 10) return
        const href = $a.attr('href') ?? ''
        const url = href.startsWith('http') ? href : `${BASE}${href}`
        releases.push({
          externalId: href.split('/').pop() ?? headline,
          headline,
          url,
        })
      })
    } else {
      rows.each((_, el) => {
        const $el = $(el)
        const $link = $el.find('a[href]').first()
        const headline = $link.text().trim() || $el.find('h2,h3,h4').first().text().trim()
        if (!headline) return

        const href = $link.attr('href') ?? ''
        const url = href.startsWith('http') ? href : `${BASE}${href}`
        const externalId = href.replace(/\/+$/, '').split('/').pop() ?? headline

        const dateStr =
          $el.find('time').attr('datetime') ??
          $el.find('time').text().trim() ??
          $el.find('.date, .news-date, .release-date').first().text().trim()

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
    }

    if (releases.length === 0) {
      return { releases: [], status: 'warn', itemsCollected: 0, error: 'No items parsed — selectors may need updating' }
    }

    return { releases, status: 'ok', itemsCollected: releases.length }
  } catch (err) {
    return { releases: [], status: 'err', itemsCollected: 0, error: String(err) }
  }
}
