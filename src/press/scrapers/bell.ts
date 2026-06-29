// Bell Flight newsroom scraper — news.bellflight.com/en-US/releases/?tags=press-release
import * as cheerio from 'cheerio'
import type { ScrapedRelease, PressScraperResult } from './types.js'
import { truncate } from './types.js'
import { zenFetch } from './zenrows.js'

const BASE = 'https://news.bellflight.com'
const LIST_URL = `${BASE}/en-US/releases/?tags=press-release`

export async function scrapeBell(): Promise<PressScraperResult> {
  try {
    const res = await zenFetch(LIST_URL)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const $ = cheerio.load(await res.text())
    const releases: ScrapedRelease[] = []

    $('.article__item').each((_, el) => {
      const $el = $(el)

      const $titleLink = $el.find('.article__title a').first()
      const headline = $titleLink.attr('title')?.trim() || $titleLink.text().trim()
      if (!headline) return

      const href = $titleLink.attr('href') ?? ''
      const url = href.startsWith('http') ? href : `${BASE}${href}`

      // Slug is the last path segment, e.g. "266743-bell-completes-..."
      const externalId = href.replace(/\/+$/, '').split('/').filter(Boolean).pop() ?? headline

      // datetime attribute is ISO date, e.g. "2026-06-11"
      const dateStr = $el.find('time[datetime]').attr('datetime')
      const publishedAt = dateStr ? new Date(dateStr) : undefined

      const excerpt = $el.find('p.article__paragraph-text').text().trim()

      // First URL from the srcset on the image holder
      const srcset = $el.find('a.article__img-holder span[data-srcset]').attr('data-srcset') ?? ''
      const imageUrl = srcset.split(',')[0]?.trim().split(' ')[0] || undefined

      releases.push({
        externalId,
        headline,
        url,
        publishedAt: publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : undefined,
        content: excerpt ? truncate(excerpt, 800) : undefined,
        imageUrl: imageUrl || undefined,
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
