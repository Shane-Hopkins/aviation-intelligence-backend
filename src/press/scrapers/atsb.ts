// Australian Transport Safety Bureau (ATSB) news scraper.
// Listing page: https://www.atsb.gov.au/atsb-news
// Server-side rendered Drupal/CivicTheme — 12 items per page.
// Article body fetched by enrichReleases() via .ct-basic-content selector in runner.ts.
import * as cheerio from 'cheerio'
import type { ScrapedRelease, PressScraperResult } from './types.js'
import { zenFetch } from './zenrows.js'

const BASE = 'https://www.atsb.gov.au'
const LIST_URL = `${BASE}/atsb-news`

export async function scrapeATSB(): Promise<PressScraperResult> {
  try {
    const res = await zenFetch(LIST_URL)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const $ = cheerio.load(await res.text())
    const releases: ScrapedRelease[] = []

    $('.ct-promo-card').each((_, el) => {
      const $el = $(el)

      // Link + headline
      const $link = $el.find('.ct-promo-card__title-link').first()
      const headline = $link.text().trim()
      if (!headline) return
      const href = $link.attr('href') ?? ''
      if (!href) return
      const url = href.startsWith('http') ? href : `${BASE}${href}`
      const externalId = href.replace(/\/$/, '').split('/').pop() ?? href

      // Date from datetime attribute
      const datetime = $el.find('time.ct-timestamp__start').attr('datetime')
      const publishedAt = datetime ? new Date(datetime) : undefined

      // Thumbnail from listing card
      const imgSrc = $el.find('.ct-promo-card__image img').attr('src') ?? ''
      const imageUrl = imgSrc
        ? (imgSrc.startsWith('http') ? imgSrc : `${BASE}${imgSrc}`)
        : undefined

      releases.push({
        externalId,
        headline,
        url,
        publishedAt: publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : undefined,
        imageUrl,
        // content/fullContent fetched by enrichReleases() via .ct-basic-content
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
