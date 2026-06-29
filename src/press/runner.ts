// Press-release runner — orchestrates all press scrapers, persists new
// releases to the database, and triggers Claude summarisation.
import * as cheerio from 'cheerio'
import Anthropic from '@anthropic-ai/sdk'
import { db } from '../db/client.js'
import { pressSources, pressReleases, pressScraperRuns } from '../db/schema.js'
import { eq, and, isNull, isNotNull } from 'drizzle-orm'

const anthropic = new Anthropic()
import { scrapeEASA } from './scrapers/easa.js'
import { scrapeBoeing } from './scrapers/boeing.js'
import { scrapeAirbus } from './scrapers/airbus.js'
import { scrapeICAO } from './scrapers/icao.js'
import { scrapeAirAmbulancesUK } from './scrapers/airambulancesuk.js'
import { scrapeAirborne } from './scrapers/airborne.js'
import { scrapeAirMethods } from './scrapers/airmethods.js'
import { scrapeArcher } from './scrapers/archer.js'
import { scrapeATSB } from './scrapers/atsb.js'
import { scrapeBell } from './scrapers/bell.js'
import { scrapeCornwallAA } from './scrapers/cornwallaa.js'
import { scrapeCAE } from './scrapers/cae.js'
import { scrapeEnstrom } from './scrapers/enstrom.js'
import { scrapeGAMA } from './scrapers/gama.js'
import { scrapeHelicopterInvestor } from './scrapers/helicopterinvestor.js'
import { scrapeITPAero } from './scrapers/itpaero.js'
import { scrapeJoby } from './scrapers/joby.js'
import { scrapeLeonardo } from './scrapers/leonardo.js'
import { scrapeLoftDynamics } from './scrapers/loftdynamics.js'
import { scrapeMDHelicopters } from './scrapers/mdhelicopters.js'
import { scrapeMetroAviation } from './scrapers/metroaviation.js'
import { scrapeMilestoneAviation } from './scrapers/milestoneaviation.js'
import { scrapeNBAA } from './scrapers/nbaa.js'
import { scrapeOmniHelicopters } from './scrapers/omnihelicopters.js'
import { scrapeAPNews } from './scrapers/apnews.js'
import { zenFetch } from './scrapers/zenrows.js'
import type { PressScraperResult, ScrapedRelease } from './scrapers/types.js'
import { sleep } from './scrapers/types.js'

// ---------------------------------------------------------------------------
// Fetch og:image and full article body for a single press release URL.
// Generic — works across FAA, EASA, TC, Boeing, Airbus, ICAO pages.
// ---------------------------------------------------------------------------
async function fetchArticleDetails(url: string): Promise<{ imageUrl?: string; fullContent?: string; publishedAt?: Date }> {
  try {
    let res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AviationPress/1.0)',
        Accept: 'text/html',
      },
      signal: AbortSignal.timeout(14_000),
    })
    // Fallback to ZenRows proxy if the site blocks data-centre IPs
    if (res.status === 403 && process.env.ZENROWS_API_KEY) {
      res = await zenFetch(url)
    }
    if (!res.ok) return {}

    const $ = cheerio.load(await res.text())

    // og:image is reliable across all major newsroom platforms
    const imageUrl =
      $('meta[property="og:image"]').attr('content') ||
      $('meta[name="twitter:image"]').attr('content') ||
      $('article img').first().attr('src') ||
      undefined

    // Published date — prefer bsp-timestamp (AP News) data-timestamp ms value,
    // fall back to article:published_time meta. Ignore dates older than 8 years.
    const MIN_PUB_YEAR = new Date().getFullYear() - 8
    const bspMs = $('bsp-timestamp[data-timestamp]').first().attr('data-timestamp')
    const bspDate = bspMs ? new Date(Number(bspMs)) : undefined
    const metaRaw = $('meta[property="article:published_time"]').attr('content')
    const metaDate = metaRaw ? new Date(metaRaw) : undefined
    const candidate = bspDate ?? metaDate
    const publishedAt = candidate && candidate.getFullYear() >= MIN_PUB_YEAR ? candidate : undefined

    // Article body — try specific selectors first, fall back to semantic tags.
    // IMPORTANT: do NOT include 'article/main' in the same comma list as specific
    // selectors — Cheerio .first() picks by document order, so a wrapping <article>
    // element wins over a more specific child selector every time.
    $('nav, header, footer, .nav, .header, .footer, .menu, .sidebar, .cookie, script, style, [class*="NewsArticleAuthor"], [class*="RelatedArticles"], [class*="ReadNext"], picture.bg-picture, a.elementor-element, .et_pb_sidebar, [class*="widget_recent_entries"], .awx-contacts, .awx-related-pages, .awx-newsfeed, .awx-anchor-links, .awx-download-resources, .awx-announcements, [class*="Author"], [class*="author"], [class*="Byline"], [class*="byline"], [class*="contributor"], [class*="Contributor"]').remove()

    // Remove CTA / newsletter sections and everything after them (e.g. Divi "Stay Updated" blocks)
    $('section, .et_pb_section, [class*="section"]').each((_, el) => {
      if ($(el).find('h1,h2,h3,h4').filter((__, h) => /stay updated|subscribe|newsletter|sign up|get in touch/i.test($(h).text())).length) {
        $(el).nextAll().remove()
        $(el).remove()
      }
    })

    let bodyEl = $(
      '.node--type-news, ' +                                   // Drupal news article (ICAO)
      '.wd_body, .wd_news_body, ' +                            // Cision/mediaroom (Boeing)
      '.field--type-text-with-summary, ' +                     // Drupal (EASA)
      '.press-release-body, .article-body, .release-content, ' +
      '.entry-content, .news-body, .content-body, .rich-text, .wysiwyg, ' +
      '.richtext, ' +                                              // Airborne Technologies
      '.the_content_wrapper, ' +                                   // ITP Aero (Muffin / BeTheme WordPress)
      '.ct-basic-content.ct-theme-light, ' +                        // ATSB (light variant = article body; dark = date/footer)
      '.e-content, ' +                                              // Omni Helicopters International
      '.elementor-location-single'                                  // Elementor single-post pages (MD Helicopters)
    ).first()

    // Fall back to semantic containers only when no specific selector matched.
    // Verify the candidate actually contains qualifying paragraphs — Elementor sites
    // have <article> elements that are related-post grid items with no body text.
    if (!bodyEl.length) {
      $('article, [role="main"], main').each((_, el) => {
        if (bodyEl.length) return
        const hasText = $(el).find('p').filter((_, p) => $(p).text().trim().length > 60).length > 0
        if (hasText) bodyEl = $(el)
      })
    }
    // Last resort: full body (catches Elementor / other frameworks with no semantic containers)

    // Collect headings, paragraphs, and inline images in document order
    const origin = new URL(url).origin
    const items: string[] = []
    let heroImageSkipped = false  // first image in body = hero/thumbnail, skip it

    // Pick the best URL from a srcset string (smallest width >= 400, else largest)
    function bestFromSrcset(srcset: string): string {
      const entries = srcset.split(',').map(s => {
        const parts = s.trim().split(/\s+/)
        return { url: parts[0], width: parseInt(parts[1]?.replace(/\D/g, '') ?? '0') }
      }).filter(e => e.url && e.width > 0)
      if (!entries.length) return ''
      const qualifying = entries.filter(e => e.width >= 400)
      return (qualifying.length ? qualifying[0] : entries[entries.length - 1]).url
    }

    ;(bodyEl.length ? bodyEl : $('body')).find('h2, h3, h4, p, img').each((_, el) => {
      if (el.type !== 'tag') return
      if (el.name === 'h2' || el.name === 'h3' || el.name === 'h4') {
        const text = $(el).text().replace(/\s+/g, ' ').trim()
        if (text.length > 3) items.push(`## ${text}`)
      } else if (el.name === 'p') {
        const text = $(el).text().replace(/\s+/g, ' ').trim()
        if (text.length > 60 && !/<\w/.test(text)) items.push(text)  // skip paragraphs with raw HTML markup
      } else if (el.name === 'img') {
        // For <picture> elements the <img> child may only have a placeholder src;
        // check the sibling <source> for real URLs via data-lazy-srcset / srcset
        const srcset = $(el).parent().is('picture')
          ? ($(el).siblings('source').first().attr('data-lazy-srcset') || $(el).siblings('source').first().attr('srcset') || '')
          : ''
        const pictureSrc = bestFromSrcset(srcset)
        // pictureSrc wins over data-lazy-src — srcset gives us a larger variant
        const src = $(el).attr('data-src') || pictureSrc || $(el).attr('data-lazy-src') || $(el).attr('src') || ''
        if (!src) return
        if (src.startsWith('data:')) return  // skip lazy-load SVG/base64 placeholders
        const lower = src.toLowerCase()
        if (lower.includes('logo') || lower.includes('icon') || lower.includes('avatar')) return
        if (lower.includes('blur=')) return  // skip lazy-load blur placeholders (e.g. Sanity ?w=20&blur=10)
        // Skip small WordPress size variants (e.g. -300x225.jpg, -150x150.webp)
        const sizeMatch = lower.match(/-(\d+)x(\d+)\.(jpe?g|png|webp|gif)/)
        if (sizeMatch && parseInt(sizeMatch[1]) < 400 && parseInt(sizeMatch[2]) < 400) return
        // Skip Liferay adaptive-media thumbnails (e.g. /w_188/, /h_200/)
        const adaptiveMatch = lower.match(/\/adaptive-media\/image\/\d+\/[wh]_(\d+)\//)
        if (adaptiveMatch && parseInt(adaptiveMatch[1]) < 400) return
        const fullSrc = src.startsWith('http') ? src : `${origin}${src.startsWith('/') ? src : '/' + src}`
        // Skip the first image — it's the hero/main image already used as the thumbnail
        if (imageUrl && !heroImageSkipped) { heroImageSkipped = true; return }
        const alt = $(el).attr('alt') ?? ''
        items.push(`![${alt}](${fullSrc})`)
      }
    })

    const fullContent = items.join('\n\n').slice(0, 8000) || undefined

    return { imageUrl, fullContent, publishedAt }
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------------------
// Enrich scraped releases with article details (og:image + full text).
// Mutates releases in-place. Rate-limited — max 15 fetches per run.
// ---------------------------------------------------------------------------
async function enrichReleases(releases: ScrapedRelease[]): Promise<void> {
  const MAX = 15
  let count = 0
  for (const r of releases) {
    if (!r.url || count >= MAX) break
    // Skip fetch if scraper already provided both image and content
    if (r.imageUrl && r.fullContent && r.publishedAt) continue
    const details = await fetchArticleDetails(r.url)
    if (details.imageUrl) r.imageUrl = details.imageUrl  // og:image is higher-res than listing thumbnail
    if (details.fullContent && !r.fullContent) r.fullContent = details.fullContent
    if (details.publishedAt && !r.publishedAt) r.publishedAt = details.publishedAt
    count++
    await sleep(300) // polite crawl rate
  }
}

// ---------------------------------------------------------------------------
// Route each source to its scraper module
// ---------------------------------------------------------------------------
async function runScraper(scraperType: string): Promise<PressScraperResult> {
  switch (scraperType) {
    case 'easa':   return scrapeEASA()
    case 'boeing': return scrapeBoeing()
    case 'airbus': return scrapeAirbus()
    case 'icao':            return scrapeICAO()
    case 'airambulancesuk': return scrapeAirAmbulancesUK()
    case 'airborne':        return scrapeAirborne()
    case 'airmethods':      return scrapeAirMethods()
    case 'archer':          return scrapeArcher()
    case 'atsb':            return scrapeATSB()
    case 'bell':            return scrapeBell()
    case 'cornwallaa':      return scrapeCornwallAA()
    case 'cae':             return scrapeCAE()
    case 'enstrom':         return scrapeEnstrom()
    case 'gama':            return scrapeGAMA()
    case 'helicopterinvestor': return scrapeHelicopterInvestor()
    case 'itpaero':            return scrapeITPAero()
    case 'joby':               return scrapeJoby()
    case 'leonardo':           return scrapeLeonardo()
    case 'loftdynamics':       return scrapeLoftDynamics()
    case 'mdhelicopters':      return scrapeMDHelicopters()
    case 'metroaviation':      return scrapeMetroAviation()
    case 'milestoneaviation':  return scrapeMilestoneAviation()
    case 'nbaa':               return scrapeNBAA()
    case 'omnihelicopters':    return scrapeOmniHelicopters()
    case 'apnews':             return scrapeAPNews()
    default:
      return { releases: [], status: 'err', itemsCollected: 0, error: `Unknown scraper type: ${scraperType}` }
  }
}

// ---------------------------------------------------------------------------
// Persist new releases — returns IDs of rows actually inserted
// ---------------------------------------------------------------------------
async function persistReleases(sourceId: number, result: PressScraperResult): Promise<number[]> {
  const newIds: number[] = []
  for (const r of result.releases) {
    try {
      const inserted = await db
        .insert(pressReleases)
        .values({
          sourceId,
          externalId: r.externalId,
          docRef: r.docRef ?? null,
          headline: r.headline,
          url: r.url ?? null,
          publishedAt: r.publishedAt ?? null,
          content: r.content ?? null,
          imageUrl: (r.imageUrl && !r.imageUrl.startsWith('data:')) ? r.imageUrl : null,
          fullContent: r.fullContent ?? null,
        })
        .onConflictDoNothing()
        .returning({ id: pressReleases.id })

      if (inserted.length > 0) {
        newIds.push(inserted[0].id)
      } else {
        // Record already exists — update fullContent/imageUrl when we now have
        // real article content (length > 200 means it's not just a headline placeholder)
        const updates: Record<string, unknown> = {}
        if (r.fullContent && r.fullContent.length > 200) updates.fullContent  = r.fullContent
        // Only upgrade imageUrl with a full-size image (og:image). Skip WordPress
        // listing thumbnails that have a size suffix like -150x100.jpg — those are
        // worse than what may already be stored. enrichReleases should have
        // replaced r.imageUrl with the og:image URL which has no size suffix.
        const isFullSize = (url: string) => !!url && !url.startsWith('data:') && !/-\d+x\d+\.(jpe?g|png|webp|gif)$/i.test(url)
        if (isFullSize(r.imageUrl)) updates.imageUrl = r.imageUrl
        if (r.publishedAt)                               updates.publishedAt  = r.publishedAt
        if (Object.keys(updates).length > 0) {
          await db
            .update(pressReleases)
            .set(updates)
            .where(
              and(
                eq(pressReleases.sourceId,   sourceId),
                eq(pressReleases.externalId, r.externalId),
              ),
            )
        }
      }
    } catch {
      // Single insert failure shouldn't stop the run
    }
  }
  return newIds
}

// ---------------------------------------------------------------------------
// Update source health status based on result
// ---------------------------------------------------------------------------
async function updateSourceStatus(sourceId: number, result: PressScraperResult): Promise<void> {
  const status =
    result.status === 'ok'   ? 'healthy'  :
    result.status === 'warn' ? 'degraded' : 'down'
  await db.update(pressSources).set({ status }).where(eq(pressSources.id, sourceId))
}

// ---------------------------------------------------------------------------
// Claude article rewrite — for AP News articles only.
// Finds articles that have fullContent but no arty_html, rewrites up to 5 per
// run, and stores the result in arty_title + arty_html.
// ---------------------------------------------------------------------------
async function rewriteAPNewsArticles(sourceId: number): Promise<void> {
  const articles = await db.query.pressReleases.findMany({
    where: and(
      eq(pressReleases.sourceId, sourceId),
      isNotNull(pressReleases.fullContent),
      isNull(pressReleases.artyHtml),
    ),
    limit: 5,
  })

  if (articles.length === 0) return
  console.log(`[press/apnews] Rewriting ${articles.length} article(s) with Claude…`)

  for (const article of articles) {
    try {
      const msg = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: `You are a journalist. Rewrite the following AP News article in clear, engaging prose, maintaining all key facts but using your own words.

Output a JSON object with exactly two fields:
- "title": a concise, compelling headline (max 12 words)
- "html": the rewritten article as an HTML fragment using only <p> tags (no outer wrapper)

Original headline: ${article.headline}

Article:
${article.fullContent}

Respond with only valid JSON, no markdown fences.`,
        }],
      })

      const raw = msg.content[0].type === 'text' ? msg.content[0].text.trim() : ''
      // Strip any accidental markdown code fences
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
      const parsed = JSON.parse(cleaned) as { title: string; html: string }

      if (parsed.title && parsed.html) {
        await db
          .update(pressReleases)
          .set({ artyTitle: parsed.title, artyHtml: parsed.html })
          .where(eq(pressReleases.id, article.id))
        console.log(`[press/apnews] Rewrote: ${parsed.title}`)
      }
    } catch (err) {
      console.error(`[press/apnews] Rewrite failed for ${article.id}:`, err)
    }
    await sleep(400)
  }
}

// ---------------------------------------------------------------------------
// Run a single press source end-to-end
// ---------------------------------------------------------------------------
export async function runPressSource(sourceId: number): Promise<void> {
  const [run] = await db
    .insert(pressScraperRuns)
    .values({ sourceId })
    .returning({ id: pressScraperRuns.id })

  const source = await db.query.pressSources.findFirst({
    where: eq(pressSources.id, sourceId),
  })

  if (!source) {
    await db
      .update(pressScraperRuns)
      .set({ status: 'err', error: 'Source not found', completedAt: new Date() })
      .where(eq(pressScraperRuns.id, run.id))
    return
  }

  console.log(`[press] Starting: ${source.name}`)

  let result: PressScraperResult
  try {
    result = await runScraper(source.scraperType)
  } catch (err) {
    result = { releases: [], status: 'err', itemsCollected: 0, error: String(err) }
  }

  // Enrich each release with og:image and full article text
  if (result.releases.length > 0) {
    console.log(`[press] Enriching up to 15 articles for ${source.name}…`)
    await enrichReleases(result.releases)
  }

  const newIds = await persistReleases(sourceId, result)
  console.log(`[press] ${source.name}: ${result.releases.length} scraped, ${newIds.length} new`)

  // AP News: rewrite article content with Claude after each run
  if (source.scraperType === 'apnews') {
    await rewriteAPNewsArticles(sourceId)
  }

  await db
    .update(pressScraperRuns)
    .set({
      status: result.status,
      itemsCollected: newIds.length,
      error: result.error ?? null,
      completedAt: new Date(),
    })
    .where(eq(pressScraperRuns.id, run.id))

  await updateSourceStatus(sourceId, result)

}

// ---------------------------------------------------------------------------
// Run all enabled press sources sequentially
// ---------------------------------------------------------------------------
export async function runAllPressSources(): Promise<void> {
  const sources = await db.query.pressSources.findMany({
    where: eq(pressSources.enabled, true),
  })

  console.log(`[press] Running ${sources.length} press scrapers…`)

  for (const source of sources) {
    try {
      await runPressSource(source.id)
    } catch (err) {
      console.error(`[press] Fatal error on ${source.name}:`, err)
    }
  }

  console.log('[press] All done.')
}

// Allow direct execution: tsx src/press/runner.ts
if (process.argv[1]?.endsWith('runner.ts') || process.argv[1]?.endsWith('runner.js')) {
  runAllPressSources().catch(console.error).finally(() => process.exit(0))
}
