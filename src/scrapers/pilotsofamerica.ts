// Pilots of America scraper — pilotsofamerica.com
// General aviation pilot community forum (XenForo-based).
// Good source for GA pilot sentiment on FAA rules, training, equipment.
import * as cheerio from 'cheerio'
import type { ScrapedPost, ScraperResult } from './types.js'
import { sleep, truncate } from './types.js'

const BASE = 'https://www.pilotsofamerica.com'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; AviationIntelligenceBot/1.0)',
  Accept: 'text/html',
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
  return res.text()
}

// XenForo sections on PoA
const SECTION_PATHS = [
  '/community/forums/aviation-news-events.6/',
  '/community/forums/rules-regs.9/',
  '/community/forums/general-aviation.4/',
]

interface ThreadRef {
  id: string
  title: string
  url: string
}

function parseThreadList(html: string): ThreadRef[] {
  const $ = cheerio.load(html)
  const threads: ThreadRef[] = []

  // XenForo thread links
  $('.structItem--thread .structItem-title a, a[href*="/threads/"]').each((_, el) => {
    const $el = $(el)
    const href = $el.attr('href') ?? ''
    const title = $el.text().trim()
    if (!title || title.length < 8 || !href) return
    const id = href.match(/threads\/[^/]+-(\d+)/)?.[1] ?? href.match(/(\d+)/)?.[1] ?? href
    threads.push({
      id,
      title,
      url: href.startsWith('http') ? href : BASE + href,
    })
  })

  return threads.slice(0, 12)
}

function parsePosts(html: string, thread: ThreadRef): ScrapedPost[] {
  const $ = cheerio.load(html)
  const posts: ScrapedPost[] = []

  // XenForo message structure
  $('article.message').each((i, el) => {
    const $el = $(el)
    const content = $el
      .find('.message-body .bbWrapper, .message-userContent')
      .text()
      .replace(/\s+/g, ' ')
      .trim()

    if (!content || content.length < 20) return

    const author = $el.find('h4.message-name a').first().text().trim() || 'unknown'
    const timeEl = $el.find('time').first()
    const postedAt = new Date(timeEl.attr('datetime') ?? '')
    const postId = $el.attr('data-content') ?? `poa_${thread.id}_${i}`

    posts.push({
      externalId: `poa_${postId.replace(/\D+/g, '')}_${thread.id}`,
      threadId: thread.id,
      threadTitle: thread.title,
      content: truncate(content),
      author,
      url: thread.url,
      postedAt: isNaN(postedAt.getTime()) ? new Date() : postedAt,
    })
  })

  return posts
}

export async function scrapePilotsOfAmerica(): Promise<ScraperResult> {
  const allPosts: ScrapedPost[] = []
  const errors: string[] = []
  let status: 'ok' | 'warn' | 'err' = 'ok'

  for (const path of SECTION_PATHS) {
    const sectionUrl = BASE + path
    try {
      const html = await fetchHtml(sectionUrl)
      const threads = parseThreadList(html)

      for (const thread of threads) {
        try {
          await sleep(1200)
          const threadHtml = await fetchHtml(thread.url)
          allPosts.push(...parsePosts(threadHtml, thread))
        } catch (err) {
          errors.push(`Thread ${thread.url}: ${err}`)
          status = 'warn'
        }
      }
      await sleep(2000)
    } catch (err) {
      errors.push(`Section ${path}: ${err}`)
      status = 'err'
    }
  }

  return {
    posts: allPosts,
    status,
    itemsCollected: allPosts.length,
    error: errors.length > 0 ? errors.join(' | ') : undefined,
  }
}
