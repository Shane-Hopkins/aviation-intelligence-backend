// Shared types for press-release scrapers.

export interface ScrapedRelease {
  externalId: string
  docRef?: string
  headline: string
  url?: string
  publishedAt?: Date
  content?: string   // abstract or blurb — fed to Claude for summarisation
}

export interface PressScraperResult {
  releases: ScrapedRelease[]
  status: 'ok' | 'warn' | 'err'
  itemsCollected: number
  error?: string
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function truncate(s: string, max = 2000): string {
  return s.length <= max ? s : s.slice(0, max) + '…'
}
