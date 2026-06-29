// Loft Dynamics press scraper.
// Source: WordPress RSS feed at https://www.loftdynamics.com/feed/
// Images and full content are embedded in <content:encoded> CDATA — no article
// page fetches needed (enrichReleases will skip items that already have both).
import * as cheerio from 'cheerio'
import type { ScrapedRelease, PressScraperResult } from './types.js'

const FEED_URL = 'https://www.loftdynamics.com/feed/'

export async function scrapeLoftDynamics(): Promise<PressScraperResult> {
  try {
    const res = await fetch(FEED_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AviationPress/1.0)', Accept: 'application/rss+xml, text/xml' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const xml = await res.text()
    const releases: ScrapedRelease[] = []

    // Split on <item> boundaries
    const items = xml.split('<item>').slice(1)

    for (const item of items) {
      const title    = item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/)?.[1]?.trim()
                    ?? item.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim()
      const link     = item.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim()
      const guid     = item.match(/<guid[^>]*>([\s\S]*?)<\/guid>/)?.[1]?.trim() ?? link
      const pubDate  = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim()
      const encoded  = item.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/)?.[1] ?? ''

      if (!title || !link || !guid) continue

      const publishedAt = pubDate ? new Date(pubDate) : undefined

      // Parse content:encoded for image and text
      const $ = cheerio.load(encoded)

      // Featured image: first img with fetchpriority="high", else first large img
      let imageUrl: string | undefined
      const featured = $('img[fetchpriority="high"]').first()
      if (featured.length) {
        imageUrl = featured.attr('src')
      } else {
        $('img').each((_, el) => {
          if (imageUrl) return
          const w = parseInt($(el).attr('width') ?? '0')
          const h = parseInt($(el).attr('height') ?? '0')
          if (w >= 400 || h >= 400) imageUrl = $(el).attr('src')
        })
      }

      // Full content: paragraphs + inline images (same logic as runner.ts enrichReleases)
      const items2: string[] = []
      $('p, img').each((_, el) => {
        if (el.type !== 'tag') return
        if (el.name === 'p') {
          const text = $(el).text().replace(/\s+/g, ' ').trim()
          if (text.length > 60) items2.push(text)
        } else if (el.name === 'img') {
          const src = $(el).attr('src') ?? ''
          if (!src || src.startsWith('data:')) return
          const lower = src.toLowerCase()
          if (lower.includes('logo') || lower.includes('icon') || lower.includes('avatar')) return
          const sizeMatch = lower.match(/-(\d+)x(\d+)\.(jpe?g|png|webp|gif)/)
          if (sizeMatch && parseInt(sizeMatch[1]) < 400 && parseInt(sizeMatch[2]) < 400) return
          const alt = $(el).attr('alt') ?? ''
          items2.push(`![${alt}](${src})`)
        }
      })
      const fullContent = items2.join('\n\n').slice(0, 8000) || undefined

      releases.push({ externalId: guid, headline: title, url: link, publishedAt, imageUrl, fullContent })
    }

    if (releases.length === 0) {
      return { releases: [], status: 'warn', itemsCollected: 0, error: 'No items in feed' }
    }

    return { releases, status: 'ok', itemsCollected: releases.length }
  } catch (err) {
    return { releases: [], status: 'err', itemsCollected: 0, error: String(err) }
  }
}
