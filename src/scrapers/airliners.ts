// Airliners.net scraper
// Airliners.net uses a custom phpBB-derived forum. Topic list URLs follow the
// pattern /forum/viewforum.php?f={id} and thread URLs /forum/viewtopic.php?t={id}
import * as cheerio from 'cheerio'
import type { ScrapedPost, ScraperResult } from './types.js'
import { sleep, truncate } from './types.js'

const BASE = 'https://www.airliners.net'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; AviationIntelligenceBot/1.0)',
  Accept: 'text/html',
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
}

function parseForumIndex(html: string): ThreadRef[] {
  const $ = cheerio.load(html)
  const threads: ThreadRef[] = []

  // phpBB: topic links in .topictitle or td.row1/row2 > a
  $('a.topictitle, .topic_title a, a[href*="viewtopic"]').each((_, el) => {
    const $el = $(el)
    const href = $el.attr('href') ?? ''
    const title = $el.text().trim()
    if (!title || !href) return
    const id = href.match(/t=(\d+)/)?.[1] ?? href
    threads.push({
      id,
      title,
      url: href.startsWith('http') ? href : BASE + '/forum/' + href.replace(/^\//, ''),
    })
  })

  return threads.slice(0, 15)
}

function parsePosts(html: string, thread: ThreadRef): ScrapedPost[] {
  const $ = cheerio.load(html)
  const posts: ScrapedPost[] = []

  // phpBB post containers
  $('div.post, div[id^="p"]').each((i, el) => {
    const $el = $(el)
    const content = $el.find('.content, .postbody').text().replace(/\s+/g, ' ').trim()
    if (!content || content.length < 20) return

    const author = $el.find('.username, strong.username, span.postAuthor').first().text().trim() || 'unknown'
    const postId = $el.attr('id') ?? `post_${thread.id}_${i}`
    const timeEl = $el.find('time, .postprofile .date').first()
    const postedAt = new Date(timeEl.attr('datetime') ?? timeEl.text())

    posts.push({
      externalId: `airliners_${postId.replace(/\D+/g, '')}_${thread.id}`,
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

export async function scrapeAirliners(forumIds: number[]): Promise<ScraperResult> {
  const allPosts: ScrapedPost[] = []
  const errors: string[] = []
  let status: 'ok' | 'warn' | 'err' = 'ok'

  // Default to the general aviation and airline-specific forum sections
  const ids = forumIds.length > 0 ? forumIds : [1, 2, 3]

  for (const fid of ids) {
    const indexUrl = `${BASE}/forum/viewforum.php?f=${fid}`
    try {
      const html = await fetchHtml(indexUrl)
      const threads = parseForumIndex(html)

      for (const thread of threads) {
        try {
          await sleep(1500)
          const threadHtml = await fetchHtml(thread.url)
          allPosts.push(...parsePosts(threadHtml, thread))
        } catch (err) {
          errors.push(`Thread ${thread.url}: ${err}`)
          status = 'warn'
        }
      }
      await sleep(2000)
    } catch (err) {
      errors.push(`Forum ${fid}: ${err}`)
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
