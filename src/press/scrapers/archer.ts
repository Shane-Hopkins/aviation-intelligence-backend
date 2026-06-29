// Archer Aviation press releases scraper.
// Source: Prismic CMS JSON API at https://news.archer.com/api/get_articles
// Returns structured content blocks — no HTML scraping needed.
import type { ScrapedRelease, PressScraperResult } from './types.js'
import { truncate } from './types.js'

const API_URL = 'https://news.archer.com/api/get_articles'

interface ContentBlock {
  type: 'paragraph' | 'list-item' | 'o-list-item' | 'image' | string
  text?: string
  url?: string
  alt?: string
}

interface ArticleData {
  heading: string
  external_url: string
  cover?: { url: string }
  content?: ContentBlock[]
}

interface Article {
  id: string
  first_publication_date: string
  data: ArticleData
}

// Convert Prismic content blocks to paragraph-structured plain text with inline image markers
function blocksToText(blocks: ContentBlock[]): string {
  const items: string[] = []
  for (const block of blocks) {
    if (block.type === 'image') {
      if (block.url) items.push(`![${block.alt ?? ''}](${block.url})`)
    } else if (block.text && block.text.trim().length > 0) {
      items.push(block.text.trim())
    }
  }
  return items.join('\n\n')
}

// Strip "Month DD, YYYY | " date prefix from headings
function stripDatePrefix(heading: string): string {
  return heading.replace(/^[A-Za-z]+ \d{1,2}, \d{4} \| /, '').trim()
}

export async function scrapeArcher(): Promise<PressScraperResult> {
  try {
    const res = await fetch(API_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AviationPress/1.0)',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const json = await res.json() as { articles: { results: Article[] } }
    const articles = json.articles?.results ?? []
    const releases: ScrapedRelease[] = []

    for (const article of articles) {
      const { data, id, first_publication_date } = article
      if (!data?.heading) continue

      const headline = stripDatePrefix(data.heading)
      const url = data.external_url || undefined
      const imageUrl = data.cover?.url || undefined
      const publishedAt = first_publication_date ? new Date(first_publication_date) : undefined

      const blocks = data.content ?? []
      const fullText = blocksToText(blocks)

      // Excerpt: first 2–3 non-empty text paragraphs
      const textBlocks = blocks.filter(b => b.type !== 'image' && (b.text ?? '').trim().length > 30)
      const excerpt = textBlocks.slice(0, 3).map(b => b.text!.trim()).join('\n\n')

      releases.push({
        externalId: id,
        headline,
        url,
        publishedAt: publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : undefined,
        imageUrl,
        content: excerpt ? truncate(excerpt, 600) : undefined,
        fullContent: fullText ? truncate(fullText, 8000) : undefined,
      })
    }

    if (releases.length === 0) {
      return { releases: [], status: 'warn', itemsCollected: 0, error: 'No articles returned from API' }
    }

    return { releases, status: 'ok', itemsCollected: releases.length }
  } catch (err) {
    return { releases: [], status: 'err', itemsCollected: 0, error: String(err) }
  }
}
