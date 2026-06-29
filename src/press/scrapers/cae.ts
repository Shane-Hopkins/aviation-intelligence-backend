// CAE press releases scraper.
// Listing: https://www.cae.com/media-centre/press-releases
// - Requires js_render=true ONLY — premium_proxy triggers OneTrust consent wall
// Article pages:
// - Also js_render=true ONLY — same reason
// Strategy: parse all items from listing (title + date inline), then fetch up to
// MAX_ARTICLE_FETCHES individual articles for body text + real image.
import * as cheerio from 'cheerio'
import type { ScrapedRelease, PressScraperResult } from './types.js'
import { truncate, sleep } from './types.js'
import { zenFetch } from './zenrows.js'

const LIST_URL = 'https://www.cae.com/media-centre/press-releases'
const DEFAULT_IMAGE = 'https://www.cae.com/assets/img/social-image.png'
const MAX_RELEASES = 25
const MAX_ARTICLE_FETCHES = 5

async function fetchArticleBody(url: string): Promise<{ fullContent?: string; imageUrl?: string }> {
  try {
    // wait=3000 gives Alpine.js time to finish rendering before ZenRows captures
    const res = await zenFetch(url, { jsRender: true, wait: 3000 }) // NO premiumProxy — it triggers consent wall
    if (!res.ok) return {}
    const $ = cheerio.load(await res.text())

    // Main body is in div.body-content.pressRelease (not the first body-content div
    // which only has the bullet summary). Collect <p> from all body-content divs.
    const paras: string[] = []
    $('[class*="body-content"]').each((_, el) => {
      $(el).find('p').each((_, p) => {
        const text = $(p).text().replace(/\s+/g, ' ').trim()
        if (text.length > 40) paras.push(text)
      })
    })
    const fullContent = paras.length > 0 ? truncate(paras.join('\n\n'), 8000) : undefined

    // Article images are served from /content/docs/ or /content/images/
    let imageUrl: string | undefined
    $('img[src*="/content/"]').each((_, el) => {
      if (imageUrl) return
      const src = $(el).attr('src') ?? ''
      if (src && !src.endsWith('.svg') && !src.includes('logo') && !src.includes('icon')) {
        imageUrl = src.startsWith('http') ? src : `https://www.cae.com${src}`
      }
    })
    // Fall back to og:image if no inline article image found
    if (!imageUrl) {
      const ogImage = $('meta[property="og:image"]').attr('content')?.trim()
      if (ogImage && !ogImage.includes('social-image.png')) imageUrl = ogImage
    }

    return { fullContent, imageUrl }
  } catch {
    return {}
  }
}

export async function scrapeCAE(): Promise<PressScraperResult> {
  try {
    const res = await zenFetch(LIST_URL, { jsRender: true })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const $ = cheerio.load(await res.text())
    const releases: ScrapedRelease[] = []

    $('a.filterableItem').each((_, el) => {
      const $el = $(el)
      const url = $el.attr('href') ?? ''
      if (!url) return

      const headline = $el.find('[role="heading"]').text().trim()
      if (!headline) return

      // Unix timestamp from Alpine x-data attribute: entryDate: 1781186100
      const xData = $el.find('[x-data]').first().attr('x-data') ?? ''
      const tsMatch = xData.match(/entryDate:\s*(\d+)/)
      const publishedAt = tsMatch ? new Date(parseInt(tsMatch[1]) * 1000) : undefined

      const releaseType = $el.find('.text-xxs').text().trim()
      const externalId = url.replace(/\/$/, '').split('/').pop() ?? url

      releases.push({
        externalId,
        headline,
        url,
        publishedAt,
        content: releaseType || undefined,
        imageUrl: DEFAULT_IMAGE,   // overwritten below for fetched articles
        fullContent: headline,     // overwritten below; pre-set prevents enrichReleases
      })
    })

    // Sort newest-first, take most recent MAX_RELEASES
    releases.sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))
    const recent = releases.slice(0, MAX_RELEASES)

    if (recent.length === 0) {
      return { releases: [], status: 'warn', itemsCollected: 0, error: 'No filterableItem elements found — selectors may need updating' }
    }

    // Fetch article bodies for the most recent items
    for (let i = 0; i < Math.min(MAX_ARTICLE_FETCHES, recent.length); i++) {
      const r = recent[i]
      if (!r.url) continue
      const { fullContent, imageUrl } = await fetchArticleBody(r.url)
      if (fullContent) r.fullContent = fullContent
      if (imageUrl)   r.imageUrl = imageUrl
      await sleep(800)
    }

    return { releases: recent, status: 'ok', itemsCollected: recent.length }
  } catch (err) {
    return { releases: [], status: 'err', itemsCollected: 0, error: String(err) }
  }
}
