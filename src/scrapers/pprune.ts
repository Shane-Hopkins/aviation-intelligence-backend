// PPRuNe scraper — Professional Pilots Rumour Network (pprune.org)
// PPRuNe runs vBulletin. We scrape thread lists then sample recent posts.
// Selectors are based on vBulletin 3/4 HTML structure — verify against live
// site if PPRuNe updates their template.
import * as cheerio from 'cheerio'
import type { ScrapedPost, ScraperResult } from './types.js'
import { sleep, truncate } from './types.js'

const BASE = 'https://www.pprune.org'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; AviationIntelligenceBot/1.0; +https://aviationintelligence.example.com/bot)',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
  return res.text()
}

interface ThreadRef {
  id: string
  title: string
  url: string
  replies: number
}

// Extract thread links from a forum section listing page
function parseThreadList(html: string): ThreadRef[] {
  const $ = cheerio.load(html)
  const threads: ThreadRef[] = []

  // vBulletin 3/4: threads are in a table with class "threadlisthead" or similar
  // XenForo (newer vB alternative): .structItemContainer .structItem
  // Try multiple selector patterns for resilience

  // Pattern 1: vBulletin standard thread list
  $('a[id^="thread_title_"]').each((_, el) => {
    const $el = $(el)
    const href = $el.attr('href') ?? ''
    const title = $el.text().trim()
    if (!title || !href) return
    const id = href.match(/\/(\d+)/)?.[1] ?? href
    threads.push({
      id,
      title,
      url: href.startsWith('http') ? href : BASE + href,
      replies: 0,
    })
  })

  // Pattern 2: XenForo-style (if vB was upgraded)
  if (threads.length === 0) {
    $('.structItem--thread .structItem-title a').each((_, el) => {
      const $el = $(el)
      const href = $el.attr('href') ?? ''
      const title = $el.text().trim()
      if (!title || !href) return
      threads.push({
        id: href.match(/\.(\d+)\/?$/)?.[1] ?? href,
        title,
        url: href.startsWith('http') ? href : BASE + '/' + href.replace(/^\//, ''),
        replies: 0,
      })
    })
  }

  // Pattern 3: plain anchor links in a #threads container
  if (threads.length === 0) {
    $('div#threads a, tr.thread a.title, td.alt1 a').each((_, el) => {
      const $el = $(el)
      const href = $el.attr('href') ?? ''
      const title = $el.text().trim()
      if (!title || !href || href === '#') return
      if (title.length < 10) return // skip nav links
      threads.push({
        id: href.match(/(\d+)/)?.[1] ?? href,
        title,
        url: href.startsWith('http') ? href : BASE + href,
        replies: 0,
      })
    })
  }

  return threads.slice(0, 20) // only process 20 most recent threads per section
}

// Extract posts from a thread page
function parsePosts(html: string, thread: ThreadRef): ScrapedPost[] {
  const $ = cheerio.load(html)
  const posts: ScrapedPost[] = []

  // vBulletin 3: posts are in div#posts > table.tborder
  // vBulletin 4: div.postcontainer
  // XenForo: article.message

  const selectors = [
    { container: 'div.postcontainer', body: 'blockquote.postcontent', author: 'div.username_container strong' },
    { container: 'table[id^="post"]', body: 'div.content', author: 'a.bigusername' },
    { container: 'article.message', body: 'div.message-userContent', author: 'h4.message-name a' },
  ]

  for (const sel of selectors) {
    $(sel.container).each((i, el) => {
      const $el = $(el)
      const content = $el.find(sel.body).text().replace(/\s+/g, ' ').trim()
      const author = $el.find(sel.author).text().trim() || 'unknown'
      const postId = $el.attr('id') ?? `post_${thread.id}_${i}`

      if (!content || content.length < 20) return

      // Extract timestamp — vBulletin uses multiple formats
      const timeEl = $el.find('span.time, span.DateTime, time').first()
      const timeStr = timeEl.attr('title') ?? timeEl.attr('datetime') ?? timeEl.text()
      const postedAt = timeStr ? new Date(timeStr) : new Date()

      posts.push({
        externalId: `pprune_${postId.replace(/\D+/g, '')}_${thread.id}`,
        threadId: thread.id,
        threadTitle: thread.title,
        content: truncate(content),
        author,
        url: thread.url,
        postedAt: isNaN(postedAt.getTime()) ? new Date() : postedAt,
      })
    })

    if (posts.length > 0) break // found posts with this selector pattern
  }

  return posts
}

export async function scrapePPRuNe(
  sectionPaths: string[],
): Promise<ScraperResult> {
  const allPosts: ScrapedPost[] = []
  let overallStatus: 'ok' | 'warn' | 'err' = 'ok'
  const errors: string[] = []

  for (const sectionPath of sectionPaths) {
    const sectionUrl = BASE + sectionPath
    try {
      const html = await fetchHtml(sectionUrl)
      const threads = parseThreadList(html)

      for (const thread of threads.slice(0, 10)) {
        try {
          await sleep(1200) // polite delay
          const threadHtml = await fetchHtml(thread.url)
          const posts = parsePosts(threadHtml, thread)
          allPosts.push(...posts)
        } catch (err) {
          errors.push(`Thread ${thread.url}: ${err}`)
          overallStatus = 'warn'
        }
      }

      await sleep(2000)
    } catch (err) {
      errors.push(`Section ${sectionPath}: ${err}`)
      overallStatus = 'err'
    }
  }

  return {
    posts: allPosts,
    status: overallStatus,
    itemsCollected: allPosts.length,
    error: errors.length > 0 ? errors.join(' | ') : undefined,
  }
}
