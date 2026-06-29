// Enstrom Helicopter press releases scraper.
// Feed: https://enstromhelicopter.com/category/press-releases/feed/
// Standard WordPress RSS — parses content:encoded CDATA for body + images.
import type { ScrapedRelease, PressScraperResult } from './types.js'
import { truncate } from './types.js'

const FEED_URL = 'https://enstromhelicopter.com/category/press-releases/feed/'
const MAX_RELEASES = 25

function htmlToText(html: string): string {
  return html
    // Convert img tags to markdown before stripping (skip logos/icons)
    .replace(/<img[^>]+>/gi, (tag) => {
      const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1] ?? ''
      if (!src) return ''
      const lower = src.toLowerCase()
      if (lower.includes('logo') || lower.includes('icon') || lower.includes('avatar')) return ''
      const alt = tag.match(/\balt=["']([^"']*)["']/i)?.[1] ?? ''
      return `\n\n![${alt}](${src})\n\n`
    })
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/The post .+? appeared first on .+?\./s, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function scrapeEnstrom(): Promise<PressScraperResult> {
  try {
    const res = await fetch(FEED_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AviationPress/1.0)', Accept: 'application/rss+xml,text/xml' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const xml = await res.text()
    const releases: ScrapedRelease[] = []

    const items = xml.match(/<item>([\s\S]*?)<\/item>/g) ?? []
    for (const item of items.slice(0, MAX_RELEASES)) {
      const title   = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1]?.trim()
                   ?? item.match(/<title>(.*?)<\/title>/)?.[1]?.trim()
      const link    = item.match(/<link>(.*?)<\/link>/)?.[1]?.trim()
                   ?? item.match(/<guid[^>]*>(.*?)<\/guid>/)?.[1]?.trim()
      const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim()
      const guid    = item.match(/<guid[^>]*>(.*?)<\/guid>/)?.[1]?.trim() ?? link ?? ''
      const desc    = item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/)?.[1] ?? ''
      const content = item.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/)?.[1] ?? desc

      if (!title || !link) continue

      const externalId = guid.match(/[?&]p=(\d+)/)?.[1] ?? guid.replace(/\/$/, '').split('/').pop() ?? guid
      const publishedAt = pubDate ? new Date(pubDate) : undefined
      const fullContent = truncate(htmlToText(content || desc), 8000) || undefined

      // imageUrl intentionally omitted — enrichReleases fetches og:image (featured image)
      // from the article page, which is the correct WordPress post thumbnail
      releases.push({
        externalId,
        headline: title,
        url: link,
        publishedAt,
        fullContent,
      })
    }

    if (releases.length === 0) {
      return { releases: [], status: 'warn', itemsCollected: 0, error: 'No items found in RSS feed' }
    }

    return { releases, status: 'ok', itemsCollected: releases.length }
  } catch (err) {
    return { releases: [], status: 'err', itemsCollected: 0, error: String(err) }
  }
}
