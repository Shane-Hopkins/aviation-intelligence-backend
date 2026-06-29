// Air Ambulances UK press release scraper.
// Uses the Yoast article-sitemap.xml to get URLs, then fetches each article page
// and parses the custom <news-intro> and <body-element> web components.
// All data (title, date, image, intro, body) lives in component attributes in the
// static HTML — no JS rendering required.
import * as cheerio from 'cheerio'
import type { ScrapedRelease, PressScraperResult } from './types.js'
import { truncate, sleep } from './types.js'

const SITEMAP_URL = 'https://www.airambulancesuk.org/article-sitemap.xml'
const SITE_SUFFIX = ' - Air Ambulances UK'
const MAX_ARTICLES = 15

interface SitemapEntry {
  url: string
  lastmod: string
}

function decodeEntities(encoded: string): string {
  return encoded
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#x20;/g, ' ')
    .replace(/&#x2019;/g, '\u2019').replace(/&#x2F;/g, '/').replace(/&#x0A;/g, '\n')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
}

// Strip HTML but preserve paragraph breaks as \n\n (used by the frontend renderer)
function htmlToText(encoded: string): string {
  const decoded = decodeEntities(encoded)
  const $ = cheerio.load(decoded)
  const paras = $('p, li, h2, h3, h4')
    .map((_, el) => $(el).text().replace(/\s+/g, ' ').trim())
    .get()
    .filter(t => t.length > 0)
  // If no block elements found, fall back to stripping all tags
  if (paras.length === 0) return decoded.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return paras.join('\n\n')
}

async function fetchSitemap(): Promise<SitemapEntry[]> {
  const res = await fetch(SITEMAP_URL, {
    headers: { 'User-Agent': 'AviationPress/1.0', Accept: 'application/xml, text/xml' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`Sitemap HTTP ${res.status}`)

  const xml = await res.text()
  const $ = cheerio.load(xml, { xmlMode: true })
  const entries: SitemapEntry[] = []

  $('url').each((_, el) => {
    const url     = $(el).find('loc').text().trim()
    const lastmod = $(el).find('lastmod').text().trim()
    if (url && lastmod) entries.push({ url, lastmod })
  })

  entries.sort((a, b) => b.lastmod.localeCompare(a.lastmod))
  return entries
}

interface ArticleData {
  headline?: string
  publishedAt?: Date
  imageUrl?: string
  content?: string
  fullContent?: string
}

async function fetchArticle(url: string): Promise<ArticleData> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AviationPress/1.0)', Accept: 'text/html' },
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) return {}

    const html = await res.text()
    const $ = cheerio.load(html)

    // <news-intro> web component — all article metadata in attributes
    // Cheerio lowercases attribute names: imageSrc → imagesrc
    const newsIntro = $('news-intro')

    const rawTitle = newsIntro.attr('title') ||
      $('meta[property="og:title"]').attr('content') || undefined
    const headline = rawTitle?.endsWith(SITE_SUFFIX)
      ? rawTitle.slice(0, -SITE_SUFFIX.length).trim()
      : rawTitle

    const dateStr   = newsIntro.attr('date')     // "16 June 2026"
    const imageSrc  = newsIntro.attr('imagesrc') // Cheerio lowercases
    const introAttr = newsIntro.attr('intro')    // HTML-encoded excerpt

    const publishedAt = dateStr ? new Date(dateStr) : undefined

    const imageUrl = (imageSrc && imageSrc.startsWith('http')) ? imageSrc :
      $('meta[property="og:image"]').attr('content') || undefined

    const content = introAttr ? truncate(htmlToText(introAttr), 800) : undefined

    // <body-element content="HTML-encoded body">
    const bodyAttr = $('body-element').attr('content')
    const fullContent = bodyAttr ? truncate(htmlToText(bodyAttr), 8000) : undefined

    return { headline, publishedAt, imageUrl, content, fullContent }
  } catch {
    return {}
  }
}

export async function scrapeAirAmbulancesUK(): Promise<PressScraperResult> {
  try {
    const entries = await fetchSitemap()
    if (entries.length === 0) {
      return { releases: [], status: 'warn', itemsCollected: 0, error: 'Sitemap returned no entries' }
    }

    const top = entries.slice(0, MAX_ARTICLES)
    const releases: ScrapedRelease[] = []

    for (const entry of top) {
      const slug = entry.url.replace(/\/$/, '').split('/').pop() ?? entry.url
      const data = await fetchArticle(entry.url)
      if (!data.headline) continue

      releases.push({
        externalId:  slug,
        headline:    data.headline,
        url:         entry.url,
        publishedAt: data.publishedAt ?? new Date(entry.lastmod),
        content:     data.content,
        imageUrl:    data.imageUrl,
        fullContent: data.fullContent,
      })

      await sleep(300)
    }

    if (releases.length === 0) {
      return { releases: [], status: 'warn', itemsCollected: 0, error: 'No articles parsed from pages' }
    }

    return { releases, status: 'ok', itemsCollected: releases.length }
  } catch (err) {
    return { releases: [], status: 'err', itemsCollected: 0, error: String(err) }
  }
}
