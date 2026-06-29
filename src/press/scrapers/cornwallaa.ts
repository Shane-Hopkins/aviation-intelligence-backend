// Cornwall Air Ambulance Trust news scraper.
// Source: WordPress RSS feed — site blocks direct fetches, so zenFetch is used.
// Full article body via content:encoded CDATA; first image extracted inline.
import * as cheerio from 'cheerio'
import type { ScrapedRelease, PressScraperResult } from './types.js'
import { truncate } from './types.js'
import { zenFetch } from './zenrows.js'

const FEED_URL = 'https://cornwallairambulancetrust.org/feed/'

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

function stripTrailer(text: string): string {
  return text.replace(/The post .+ appeared first on .+\.$/, '').trim()
}

// Extract the first wp-content image URL from HTML
function firstImage(html: string): string | undefined {
  const m = html.match(/src="(https?:\/\/cornwallairambulancetrust\.org\/wp-content\/uploads\/[^"]+\.(jpe?g|png|webp))"/i)
  return m?.[1]
}

export async function scrapeCornwallAA(): Promise<PressScraperResult> {
  try {
    const res = await zenFetch(FEED_URL)
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

      // WordPress post ID from guid
      const guid = chunk.match(/<guid[^>]*>(.*?)<\/guid>/)?.[1]?.trim() ?? ''
      const postId = guid.match(/[?&]p=(\d+)/)?.[1]
      const externalId = postId ?? url.replace(/\/$/, '').split('/').pop() ?? guid

      const pubDateStr = chunk.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim()
      const publishedAt = pubDateStr ? new Date(pubDateStr) : undefined

      const descCdata = chunk.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/)?.[1] ?? ''
      const content = descCdata ? truncate(stripTrailer(htmlToText(descCdata)), 500) : undefined

      const contentCdata = chunk.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/)?.[1] ?? ''
      const fullContent = contentCdata ? truncate(stripTrailer(htmlToText(contentCdata)), 8000) : undefined
      const imageUrl = contentCdata ? firstImage(contentCdata) : undefined

      releases.push({
        externalId,
        headline,
        url: url || undefined,
        publishedAt: publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : undefined,
        content: content || undefined,
        fullContent: fullContent || undefined,
        imageUrl,
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
