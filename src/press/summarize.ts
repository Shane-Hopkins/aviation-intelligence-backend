// Claude batch summarisation for press releases.
// Processes up to 10 releases per API call to extract category, jurisdiction,
// effective date, and a 2-3 sentence AI summary.
import Anthropic from '@anthropic-ai/sdk'
import { db } from '../db/client.js'
import { pressReleases } from '../db/schema.js'
import { eq } from 'drizzle-orm'

const client = new Anthropic()
const BATCH_SIZE = 10

interface SummariseInput {
  id: number
  headline: string
  content: string | null
  sourceName: string
}

interface SummariseOutput {
  id: number
  category: 'Safety' | 'Regulation' | 'Industry'
  jurisdiction: string
  effectiveDate: string
  summary: string
}

async function summariseBatch(items: SummariseInput[]): Promise<SummariseOutput[]> {
  const prompt = `You are an aviation regulatory intelligence analyst. For each press release below, extract:
- category: one of "Safety", "Regulation", or "Industry"
- jurisdiction: the governing body's territory (e.g. "United States", "European Union", "Canada", "International", or the OEM's primary country)
- effectiveDate: the compliance or effective date in YYYY-MM-DD format, or a short label like "Consultation", "Advisory", "TBD" if no hard date
- summary: a factual 2-3 sentence summary of what the release says and its operational significance

Respond with a JSON array only (no markdown, no extra text):
[
  {
    "id": <number>,
    "category": "Safety" | "Regulation" | "Industry",
    "jurisdiction": "...",
    "effectiveDate": "...",
    "summary": "..."
  }
]

Press releases:
${JSON.stringify(items.map(i => ({ id: i.id, source: i.sourceName, headline: i.headline, content: i.content ?? '' })), null, 2)}`

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '[]'
  const clean = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()

  try {
    return JSON.parse(clean) as SummariseOutput[]
  } catch {
    console.error('[press/summarize] JSON parse failed:', clean.slice(0, 200))
    return []
  }
}

// ---------------------------------------------------------------------------
// Summarise all new press releases that don't have an AI summary yet.
// sourceNameById maps pressRelease.sourceId → source display name.
// ---------------------------------------------------------------------------
export async function summariseNewReleases(
  releaseIds: number[],
  sourceNameById: Map<number, string>,
): Promise<void> {
  if (releaseIds.length === 0) return

  // Fetch rows that still need summarisation
  const allRows = await db.query.pressReleases.findMany({
    where: (t, { and, inArray, isNull }) =>
      and(inArray(t.id, releaseIds), isNull(t.aiSummary)),
  })

  if (allRows.length === 0) return
  console.log(`[press/summarize] Summarising ${allRows.length} releases…`)

  const inputs: SummariseInput[] = allRows.map(r => ({
    id: r.id,
    headline: r.headline,
    content: r.content,
    sourceName: sourceNameById.get(r.sourceId) ?? 'Unknown',
  }))

  for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
    const batch = inputs.slice(i, i + BATCH_SIZE)
    try {
      const results = await summariseBatch(batch)
      for (const r of results) {
        await db
          .update(pressReleases)
          .set({
            category: r.category,
            jurisdiction: r.jurisdiction,
            effectiveDate: r.effectiveDate,
            aiSummary: r.summary,
          })
          .where(eq(pressReleases.id, r.id))
      }
      console.log(`[press/summarize] Batch ${Math.floor(i / BATCH_SIZE) + 1} done (${results.length} summarised)`)
    } catch (err) {
      console.error(`[press/summarize] Batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`, err)
    }
  }
}
