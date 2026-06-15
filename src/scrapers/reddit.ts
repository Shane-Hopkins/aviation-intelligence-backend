// Reddit scraper — uses Arctic Shift (https://arctic-shift.photon-reddit.com),
// an open Reddit mirror that doesn't require authentication.
import type { ScrapedPost, ScraperResult } from './types.js'
import { sleep, truncate } from './types.js'

const BASE = 'https://arctic-shift.photon-reddit.com/api/posts/search'
const PAGE_SIZE = 100

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parsePost(d: any): ScrapedPost | null {
  if (!d?.id || !d?.title) return null
  if (d.selftext === '[deleted]' || d.selftext === '[removed]') return null

  return {
    externalId: `reddit_${d.id}`,
    threadId: d.id,
    threadTitle: d.title,
    content: truncate(d.selftext || d.title),
    author: d.author ?? '[deleted]',
    url: `https://www.reddit.com${d.permalink}`,
    postedAt: new Date((d.created_utc ?? d.created) * 1000),
  }
}

export async function scrapeReddit(
  subreddit: string,
  maxPages = 3,
): Promise<ScraperResult> {
  const posts: ScrapedPost[] = []
  let error: string | undefined
  // Paginate using `before` unix timestamp — start from now, walk backwards
  let before: number | undefined

  try {
    for (let page = 0; page < maxPages; page++) {
      let url = `${BASE}?subreddit=${subreddit}&limit=${PAGE_SIZE}&sort=desc`
      if (before) url += `&before=${before}`

      const res = await fetch(url)
      if (!res.ok) throw new Error(`Arctic Shift API ${res.status}: ${res.statusText}`)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const json = await res.json() as any
      const items: unknown[] = json?.data ?? []

      if (items.length === 0) break

      for (const item of items) {
        const post = parsePost(item)
        if (post) posts.push(post)
      }

      // Next page: posts older than the last one in this batch
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const last = items[items.length - 1] as any
      before = last?.created_utc ?? last?.created
      if (!before) break

      await sleep(500)
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
    return { posts, status: 'err', itemsCollected: posts.length, error }
  }

  const status = posts.length === 0 ? 'warn' : 'ok'
  return { posts, status, itemsCollected: posts.length, error }
}
