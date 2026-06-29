// Air Methods press releases scraper.
// Source: WordPress RSS feed at /press-releases/feed/
// Full article body via content:encoded CDATA; og:image fetched by enrichReleases().
import * as cheerio from 'cheerio'
import type { ScrapedRelease, PressScraperResult } from './types.js'
import { truncate } from './types.js'

const FEED_URL = 'https://www.airmethods.com/press-releases/feed/'

// Convert HTML (from CDATA block) to paragraph-joined plain text
function htmlToText(html: string): string {
  const $ = cheerio.load(html)
  $('script, style').remove()
  const paras = $('p, li, h2, h3, h4')
    .map((_, el) => $(el).text().replace(/\s+/g, ' ').trim())
    .get()
    .filter(t => t.length > 30)
  if (paras.length === 0) return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return paras.join('\n\n')
}

// Strip WordPress "The post X appeared first on Y." trailer
function stripTrailer(text: string): string {
  return text.replace(/The post .+ appeared first on .+\.$/, '').trim()
}

export async function scrapeAirMethods(): Promise<PressScraperResult> {
  try {
    const res = await fetch(FEED_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AviationPress/1.0)',
        Accept: 'application/rss+xml, text/xml',
      },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const xml = await res.text()
    const releases: ScrapedRelease[] = []

    const itemRe = /<item>([\s\S]*?)<\/item>/g
    let m: RegExpExecArray | null
    while ((m = itemRe.exec(xml)) !== null) {
      const chunk = m[1]

      const headline = (
        chunk.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/)?.[1] ??
        chunk.match(/<title>(.*?)<\/title>/)?.[1]
      )?.trim()
      if (!headline) continue

      const url = chunk.match(/<link>(.*?)<\/link>/)?.[1]?.trim() ?? ''

      // WordPress post ID from guid (e.g. https://www.airmethods.com/?p=57959)
      const guid = chunk.match(/<guid[^>]*>(.*?)<\/guid>/)?.[1]?.trim() ?? ''
      const postId = guid.match(/[?&]p=(\d+)/)?.[1]
      const externalId = postId ?? url.replace(/\/$/, '').split('/').pop() ?? guid

      const pubDateStr = chunk.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim()
      const publishedAt = pubDateStr ? new Date(pubDateStr) : undefined

      // Excerpt
      const descCdata = chunk.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/)?.[1] ?? ''
      const content = descCdata
        ? truncate(stripTrailer(htmlToText(descCdata)), 500)
        : undefined

      // Full article body
      const contentCdata = chunk.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/)?.[1] ?? ''
      const fullContent = contentCdata
        ? truncate(stripTrailer(htmlToText(contentCdata)), 8000)
        : undefined

      releases.push({
        externalId,
        headline,
        url: url || undefined,
        publishedAt: publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : undefined,
        content: content || undefined,
        fullContent: fullContent || undefined,
        // imageUrl left unset — enrichReleases() fetches og:image from article page
      })
    }

    if (releases.length === 0) {
      return { releases: [], status: 'warn', itemsCollected: 0, error: 'No items found in feed' }
    }

    return { releases, status: 'ok', itemsCollected: releases.length }
  } catch (err) {
    return { releases: [], status: 'err', itemsCollected: 0, error: String(err) }
  }
}
