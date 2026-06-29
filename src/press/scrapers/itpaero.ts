// ITP Aero news scraper.
// Listing: https://www.itpaero.com/en/news/
// Images are directly in src (no lazy-loading). Article body in .the_content_wrapper.
// fullContent left unset — enrichReleases fetches og:image + body via .the_content_wrapper.
import * as cheerio from 'cheerio'
import type { ScrapedRelease, PressScraperResult } from './types.js'

const LIST_URL = 'https://www.itpaero.com/en/news/'
const MAX_RELEASES = 25

export async function scrapeITPAero(): Promise<PressScraperResult> {
  try {
    const res = await fetch(LIST_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AviationPress/1.0)', Accept: 'text/html' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const $ = cheerio.load(await res.text())
    const releases: ScrapedRelease[] = []

    $('article.post-item').each((_, el) => {
      const $el = $(el)

      // Post ID from article class, e.g. "post-16254"
      const classes = ($el.attr('class') ?? '').split(/\s+/)
      const postClass = classes.find(c => /^post-\d+$/.test(c)) ?? ''
      const externalId = postClass.replace('post-', '') || postClass

      // Title + URL
      const $a = $el.find('.post-title a, h6.entry-title a, h5.entry-title a').first()
      const headline = $a.text().trim()
      const url = $a.attr('href')?.trim()
      if (!headline || !url || !externalId) return

      // Thumbnail — wp-post-image has a real src (no lazy loading)
      const imageUrl = $el.find('img.wp-post-image').attr('src')?.trim() || undefined

      // Date from .post-date span
      const dateText = $el.find('.post-date').text().trim()
      let publishedAt: Date | undefined
      if (dateText) {
        const d = new Date(dateText)
        if (!isNaN(d.getTime())) publishedAt = d
      }

      // Short excerpt from listing
      const content = $el.find('.post-excerpt').text().replace(/\[\s*…\s*\]/, '').replace(/\s+/g, ' ').trim() || undefined

      releases.push({ externalId, headline, url, imageUrl, publishedAt, content })
    })

    if (releases.length === 0) {
      return { releases: [], status: 'warn', itemsCollected: 0, error: 'No article.post-item elements found' }
    }

    return { releases: releases.slice(0, MAX_RELEASES), status: 'ok', itemsCollected: Math.min(releases.length, MAX_RELEASES) }
  } catch (err) {
    return { releases: [], status: 'err', itemsCollected: 0, error: String(err) }
  }
}
