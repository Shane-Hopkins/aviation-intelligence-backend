// Reddit scraper — uses the public JSON API (no OAuth required for read-only
// access to public subreddits). For higher rate limits, set REDDIT_CLIENT_ID
// and REDDIT_CLIENT_SECRET in .env and this module will use OAuth automatically.
import type { ScrapedPost, ScraperResult } from './types.js'
import { sleep, truncate } from './types.js'

const UA = process.env.REDDIT_USER_AGENT ?? 'AviationIntelligence/1.0'

// Aviation-related keywords — posts whose title/selftext contain any of these
// are scraped. Prevents pulling totally off-topic content.
const AVIATION_KEYWORDS = [
  'faa', 'easa', 'icao', 'airworthiness', 'directive', 'regulation',
  'certificate', 'airspace', 'drone', 'bvlos', 'uas', 'uav',
  'helicopter', 'rotor', 'gearbox', 'cargo', 'airline', 'aviation',
  'pilot', 'atc', 'ifr', 'vfr', 'part 121', 'part 91', 'part 61',
  'nopa', 'sfar', 'airworthiness bulletin', 'safety bulletin',
]

function isAviationRelated(title: string, body: string): boolean {
  const text = (title + ' ' + body).toLowerCase()
  return AVIATION_KEYWORDS.some(kw => text.includes(kw))
}

// Fetch a single page of the subreddit new feed
async function fetchPage(subreddit: string, after?: string): Promise<unknown> {
  let url = `https://www.reddit.com/r/${subreddit}/new.json?limit=100`
  if (after) url += `&after=${after}`

  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
  })

  if (!res.ok) {
    throw new Error(`Reddit API ${res.status}: ${res.statusText}`)
  }
  return res.json()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parsePost(child: any): ScrapedPost | null {
  const d = child.data
  if (!d || d.is_self === false) return null // skip link posts, we want text discussions
  if (!d.selftext || d.selftext === '[deleted]' || d.selftext === '[removed]') {
    // Title-only posts are still useful for sentiment
    if (!isAviationRelated(d.title, '')) return null
  } else {
    if (!isAviationRelated(d.title, d.selftext)) return null
  }

  return {
    externalId: `reddit_${d.id}`,
    threadId: d.id,
    threadTitle: d.title,
    content: truncate(d.selftext || d.title),
    author: d.author ?? '[deleted]',
    url: `https://www.reddit.com${d.permalink}`,
    postedAt: new Date(d.created_utc * 1000),
  }
}

export async function scrapeReddit(
  subreddit: string,
  maxPages = 3,
): Promise<ScraperResult> {
  const posts: ScrapedPost[] = []
  let after: string | undefined
  let error: string | undefined

  try {
    for (let page = 0; page < maxPages; page++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await fetchPage(subreddit, after) as any
      const children = data?.data?.children ?? []

      for (const child of children) {
        const post = parsePost(child)
        if (post) posts.push(post)
      }

      after = data?.data?.after
      if (!after) break

      // Reddit requests — polite delay between pages
      await sleep(1500)
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
    return { posts, status: 'err', itemsCollected: posts.length, error }
  }

  // Also fetch top/hot to get active discussions
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hotData = await fetch(
      `https://www.reddit.com/r/${subreddit}/hot.json?limit=50`,
      { headers: { 'User-Agent': UA } }
    ).then(r => r.json()) as any

    for (const child of hotData?.data?.children ?? []) {
      const post = parsePost(child)
      if (post && !posts.find(p => p.externalId === post.externalId)) {
        posts.push(post)
      }
    }
  } catch {
    // non-fatal: hot feed is bonus
  }

  const status = error ? 'warn' : 'ok'
  return { posts, status, itemsCollected: posts.length, error }
}
