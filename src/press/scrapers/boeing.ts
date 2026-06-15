// Boeing newsroom scraper — scrapes boeing.mediaroom.com.
import * as cheerio from 'cheerio'
import type { ScrapedRelease, PressScraperResult } from './types.js'
import { truncate } from './types.js'

const BASE = 'https://boeing.mediaroom.com'
// ?rss=1 forces server-side rendering on the Cision/mediaroom platform
const LIST_URL = `${BASE}/news-releases-statements?rss=1`

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

    // Boeing uses Cision/mediaroom platform — primary classes are wd_item/wd_title
    const rowSelectors = [
      '.wd_item',
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
      // Generic fallback: anchors matching Boeing mediaroom URL patterns
      $('a[href*="?item="], a[href*="/news-releases"], a[href*="/press-release"], a[href*="/statement"]').each((_, el) => {
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
        // Cision/mediaroom uses .wd_title for the headline link; fall back to first anchor
        const $titleEl = $el.find('.wd_title a, a[href]').first()
        const headline = $titleEl.text().trim() || $el.find('h2,h3,h4').first().text().trim()
        if (!headline) return

        const href = $titleEl.attr('href') ?? $el.find('a[href]').first().attr('href') ?? ''
        const url = href.startsWith('http') ? href : `${BASE}${href}`
        const externalId = href.replace(/[?&].*$/, '').replace(/\/+$/, '').split('/').pop() ?? headline

        const dateStr =
          $el.find('.wd_date').first().text().trim() ||
          ($el.find('time').attr('datetime') ??
          $el.find('time').text().trim() ??
          $el.find('.date, .news-date, .release-date').first().text().trim())

        const publishedAt = dateStr ? new Date(dateStr) : undefined
        const blurb = $el.find('.wd_summary, p').first().text().trim()

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
