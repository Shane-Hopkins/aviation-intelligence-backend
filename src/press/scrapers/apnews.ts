// AP News — helicopter news scraper.
// Searches two queries (helicopter / helicopter crash) and deduplicates.
// Search results are AJAX-loaded — waitFor ensures the results container populates.
// Dates come from data-posted-date-timestamp on each PagePromo card (reliable ms timestamp).
// Article body enriched by runner.ts fetchArticleDetails (.article-body selector).
// After enrichment, runner.ts calls rewriteAPNewsArticles() to Claude-rewrite content.
import * as cheerio from 'cheerio'
import { zenFetch } from './zenrows.js'
import type { ScrapedRelease, PressScraperResult } from './types.js'
import { sleep } from './types.js'

const SEARCH_URLS = [
  'https://apnews.com/search?q=helicopter&s=3',
  'https://apnews.com/search?q=helicopter+crash&s=3',
  'https://apnews.com/search?q=helicopter+accident&s=3',
  'https://apnews.com/search?q=helicopter+rescue&s=3',
  'https://apnews.com/search?q=medevac&s=3',
  'https://apnews.com/search?q=rotorcraft&s=3',
]

async function fetchSearchResults(url: string): Promise<ScrapedRelease[]> {
  const res = await zenFetch(url, {
    jsRender: true,
    waitFor: '.SearchResultsModule-results .PagePromo',
  })
  if (!res.ok) return []

  const $ = cheerio.load(await res.text())
  const releases: ScrapedRelease[] = []

  $('.SearchResultsModule-results .PagePromo').each((_, el) => {
    // Headline + URL from the title link
    const titleEl = $(el).find('.PagePromo-title a, h3 a, h2 a').first()
    const headline = titleEl.text().trim()
    let href = titleEl.attr('href') ?? ''
    if (!headline || !href) return
    if (!/helicopter|rotorcraft|medevac/i.test(headline)) return

    if (href.startsWith('/')) href = `https://apnews.com${href}`
    if (!href.includes('apnews.com/article/')) return

    const slug = href.replace(/\/$/, '').split('/').pop() ?? ''
    if (!slug) return

    // Date from data-posted-date-timestamp (ms Unix timestamp — accurate & reliable)
    const tsMs = $(el).attr('data-posted-date-timestamp')
    const publishedAt = tsMs ? new Date(Number(tsMs)) : undefined

    // Thumbnail
    const imgSrc = $(el).find('img').first().attr('src') ?? ''
    const imageUrl = imgSrc && !imgSrc.startsWith('data:') ? imgSrc : undefined

    releases.push({ externalId: slug, headline, url: href, publishedAt, imageUrl })
  })

  return releases
}

export async function scrapeAPNews(): Promise<PressScraperResult> {
  try {
    const seen = new Set<string>()
    const releases: ScrapedRelease[] = []

    for (const url of SEARCH_URLS) {
      const batch = await fetchSearchResults(url)
      for (const r of batch) {
        if (!seen.has(r.externalId)) {
          seen.add(r.externalId)
          releases.push(r)
        }
      }
      if (SEARCH_URLS.indexOf(url) < SEARCH_URLS.length - 1) await sleep(2000)
    }

    if (releases.length === 0) {
      return { releases: [], status: 'warn', itemsCollected: 0, error: 'No helicopter articles found in search results' }
    }

    return { releases, status: 'ok', itemsCollected: releases.length }
  } catch (err) {
    return { releases: [], status: 'err', itemsCollected: 0, error: String(err) }
  }
}
