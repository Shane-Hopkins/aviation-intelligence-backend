// Shared types for all scrapers

export interface ScrapedPost {
  externalId: string      // stable unique ID within the forum
  threadId: string        // thread/topic the post belongs to
  threadTitle: string     // title of the parent thread
  content: string         // post body text (up to ~2000 chars)
  author: string
  url: string             // direct link to post
  postedAt: Date
}

export interface ScraperResult {
  posts: ScrapedPost[]
  status: 'ok' | 'warn' | 'err'
  itemsCollected: number
  error?: string
}

export interface ForumConfig {
  id: number
  name: string
  handle: string
  url: string
  scraperType: string
  scraperConfig: Record<string, unknown>
}

// Delay helper used by all scrapers to be polite to servers
export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Truncate post content to avoid sending huge texts to Claude
export function truncate(text: string, maxChars = 2000): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + '…'
}
