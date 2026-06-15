// EASA press-release scraper.
// EASA's listing page is fully JS-rendered (Drupal Views AJAX).
// We call the Views AJAX endpoint directly which returns a JSON array of
// Drupal commands; one of them contains the rendered HTML for the listing.
import * as cheerio from 'cheerio'
import type { ScrapedRelease, PressScraperResult } from './types.js'
import { truncate } from './types.js'

const BASE = 'https://www.easa.europa.eu'
const AJAX_URL =
  `${BASE}/en/views/ajax` +
  `?view_name=press_release` +
  `&view_display_id=page_press_release` +
  `&view_path=/en/newsroom-and-events/press-releases`

export async function scrapeEASA(): Promise<PressScraperResult> {
  try {
    const res = await fetch(AJAX_URL, {
      headers: {
        'User-Agent': 'AviationPress/1.0',
        Accept: 'application/json, text/javascript, */*',
        'X-Requested-With': 'XMLHttpRequest',
      },
      signal: AbortSignal.timeout(25_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    // Response is a JSON array of Drupal AJAX commands.
    // We find the "insert" command that contains the rendered listing HTML.
    const commands = await res.json() as Array<{ command: string; data?: string; method?: string }>
    const insertCmd = commands.find(c => c.command === 'insert' && c.data && c.data.includes('node--type-easa-press-release'))
    if (!insertCmd?.data) {
      return { releases: [], status: 'warn', itemsCollected: 0, error: 'AJAX response missing press-release HTML' }
    }

    const $ = cheerio.load(insertCmd.data)
    const releases: ScrapedRelease[] = []

    $('article.node--type-easa-press-release').each((_, el) => {
      const $el = $(el)
      const $link = $el.find('a[href]').first()
      const headline = $link.text().trim() || $el.find('h2,h3,h4').first().text().trim()
      const href = $link.attr('href') ?? ''
      if (!headline) return

      const url = href.startsWith('http') ? href : `${BASE}${href}`
      const externalId = href.replace(/\/+$/, '').split('/').pop() ?? headline

      const dateStr =
        $el.find('time').attr('datetime') ??
        $el.find('time').text().trim()

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
      return { releases: [], status: 'warn', itemsCollected: 0, error: 'No items parsed from AJAX response' }
    }

    return { releases, status: 'ok', itemsCollected: releases.length }
  } catch (err) {
    return { releases: [], status: 'err', itemsCollected: 0, error: String(err) }
  }
}
