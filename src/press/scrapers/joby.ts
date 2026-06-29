// Joby Aviation news scraper.
// Listing: https://www.jobyaviation.com/news
// Next.js SSG site — all article metadata is in __NEXT_DATA__ on the listing page.
// imageUrl comes from featuredImage.asset.url (Sanity CDN, full-size).
// fullContent left unset — enrichReleases fetches article body via <main> element.
import type { ScrapedRelease, PressScraperResult } from './types.js'

const LIST_URL = 'https://www.jobyaviation.com/news'
const BASE_URL = 'https://www.jobyaviation.com'

export async function scrapeJoby(): Promise<PressScraperResult> {
  try {
    const res = await fetch(LIST_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AviationPress/1.0)', Accept: 'text/html' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const html = await res.text()

    // Extract __NEXT_DATA__ JSON embedded in the page
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
    if (!match) throw new Error('__NEXT_DATA__ not found')

    const data = JSON.parse(match[1])
    const articles: unknown[] = data?.props?.pageProps?.newsArticles ?? []
    if (!Array.isArray(articles) || articles.length === 0) {
      return { releases: [], status: 'warn', itemsCollected: 0, error: 'No newsArticles in __NEXT_DATA__' }
    }

    const releases: ScrapedRelease[] = []

    for (const a of articles) {
      const article = a as Record<string, unknown>
      const id     = article._id as string | undefined
      const title  = article.title as string | undefined
      const slug   = (article.slug as Record<string, string> | undefined)?.current
      if (!id || !title || !slug) continue

      const url         = `${BASE_URL}/news/${slug}`
      const publishedAt = article.publishedAt ? new Date(article.publishedAt as string) : undefined
      const imgAsset    = (article.featuredImage as Record<string, Record<string, string>> | undefined)?.asset
      const imageUrl    = imgAsset?.url || undefined

      releases.push({ externalId: id, headline: title, url, publishedAt, imageUrl })
    }

    if (releases.length === 0) {
      return { releases: [], status: 'warn', itemsCollected: 0, error: 'No parseable articles' }
    }

    return { releases, status: 'ok', itemsCollected: releases.length }
  } catch (err) {
    return { releases: [], status: 'err', itemsCollected: 0, error: String(err) }
  }
}
