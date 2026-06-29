// FAA press-release scraper — uses the Federal Register public API.
// No API key required; rate limit is generous for read requests.
import type { ScrapedRelease, PressScraperResult } from './types.js'
import { truncate } from './types.js'

interface FRDoc {
  document_number: string
  title: string
  html_url: string
  publication_date: string
  type: string
  abstract?: string
}

interface FRResponse {
  count: number
  results: FRDoc[]
}

// Regulatory doc types we care about — filter out Presidential docs, Corrections etc.
const RELEVANT_TYPES = new Set(['Rule', 'Proposed Rule', 'Notice'])

// Separate fields[] params — the API rejects comma-separated field lists
const FR_URL =
  'https://www.federalregister.gov/api/v1/documents.json' +
  '?agencies[]=federal-aviation-administration' +
  '&per_page=25' +
  '&order=newest' +
  '&fields[]=document_number' +
  '&fields[]=title' +
  '&fields[]=html_url' +
  '&fields[]=publication_date' +
  '&fields[]=type' +
  '&fields[]=abstract'

export async function scrapeFAA(): Promise<PressScraperResult> {
  try {
    const res = await fetch(FR_URL, {
      headers: { Accept: 'application/json', 'User-Agent': 'AviationPress/1.0' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const data = await res.json() as FRResponse

    const releases: ScrapedRelease[] = (data.results ?? [])
      .filter(doc => RELEVANT_TYPES.has(doc.type))
      .map(doc => ({
        externalId: doc.document_number,
        docRef: doc.document_number,
        headline: doc.title,
        url: doc.html_url,
        publishedAt: doc.publication_date ? new Date(doc.publication_date) : undefined,
        content: doc.abstract ? truncate(doc.abstract, 1500) : undefined,
      }))

    return { releases, status: 'ok', itemsCollected: releases.length }
  } catch (err) {
    return { releases: [], status: 'err', itemsCollected: 0, error: String(err) }
  }
}
