// POST /api/ask/press
// RAG endpoint for the "Ask the data" panel on the Dashboard screen.
// Retrieves relevant press releases, then synthesises an answer with Claude
// that cites the actual documents.
import { Hono } from 'hono'
import Anthropic from '@anthropic-ai/sdk'
import { db } from '../../db/client.js'
import { pressReleases, pressSources } from '../../db/schema.js'
import { sql, desc, eq, isNotNull } from 'drizzle-orm'

const router = new Hono()
const client = new Anthropic()

// ---------------------------------------------------------------------------
// Retrieve relevant press releases using ILIKE keyword search
// ---------------------------------------------------------------------------
async function retrieveReleases(query: string, limit = 20) {
  const keywords = query
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3)
    .slice(0, 6)

  const base = db
    .select({
      id:           pressReleases.id,
      docRef:       pressReleases.docRef,
      externalId:   pressReleases.externalId,
      headline:     pressReleases.headline,
      url:          pressReleases.url,
      publishedAt:  pressReleases.publishedAt,
      category:     pressReleases.category,
      jurisdiction: pressReleases.jurisdiction,
      effectiveDate:pressReleases.effectiveDate,
      aiSummary:    pressReleases.aiSummary,
      sourceCode:   pressSources.code,
      sourceName:   pressSources.name,
    })
    .from(pressReleases)
    .innerJoin(pressSources, eq(pressSources.id, pressReleases.sourceId))
    .where(isNotNull(pressReleases.aiSummary))
    .orderBy(desc(pressReleases.publishedAt))
    .limit(limit)

  if (keywords.length === 0) return base

  // Apply first keyword as WHERE condition (simple approach — sufficient for MVP)
  const kw = keywords[0]
  return db
    .select({
      id:           pressReleases.id,
      docRef:       pressReleases.docRef,
      externalId:   pressReleases.externalId,
      headline:     pressReleases.headline,
      url:          pressReleases.url,
      publishedAt:  pressReleases.publishedAt,
      category:     pressReleases.category,
      jurisdiction: pressReleases.jurisdiction,
      effectiveDate:pressReleases.effectiveDate,
      aiSummary:    pressReleases.aiSummary,
      sourceCode:   pressSources.code,
      sourceName:   pressSources.name,
    })
    .from(pressReleases)
    .innerJoin(pressSources, eq(pressSources.id, pressReleases.sourceId))
    .where(
      sql`${isNotNull(pressReleases.aiSummary)} and (
        lower(${pressReleases.headline}) like ${'%' + kw + '%'} or
        lower(${pressReleases.aiSummary}) like ${'%' + kw + '%'} or
        lower(coalesce(${pressReleases.docRef}, '')) like ${'%' + kw + '%'}
      )`,
    )
    .orderBy(desc(pressReleases.publishedAt))
    .limit(limit)
}

// ---------------------------------------------------------------------------
// Ask Claude to synthesise an answer citing the retrieved releases
// ---------------------------------------------------------------------------
async function synthesise(
  query: string,
  docs: Awaited<ReturnType<typeof retrieveReleases>>,
): Promise<{
  paragraphs: { text: string; cites: string[]; tail: string }[]
  sources: { num: string; label: string; src: string; url: string }[]
}> {
  if (docs.length === 0) {
    return {
      paragraphs: [{ text: 'No relevant press releases found for that query.', cites: [], tail: '' }],
      sources: [],
    }
  }

  const context = docs.map((d, i) => ({
    index: i + 1,
    ref: d.docRef ?? d.externalId,
    source: d.sourceName,
    headline: d.headline,
    summary: d.aiSummary ?? '',
    category: d.category ?? 'Industry',
    jurisdiction: d.jurisdiction ?? '',
    effectiveDate: d.effectiveDate ?? '',
    url: d.url ?? '',
  }))

  const prompt = `You are an aviation regulatory intelligence analyst answering a user's question about press releases and official documents.

User question: "${query}"

You have ${context.length} relevant press releases. Write a clear, factual 2-3 paragraph answer that:
- Directly addresses the question
- Cites specific documents inline using their ref value in the format [ref: "DOC-REF"] where DOC-REF is the ref field
- Stays grounded in what the documents actually say
- Notes jurisdiction and effective dates where relevant

Documents (indexed for citation):
${JSON.stringify(context, null, 2)}

Respond with JSON only (no markdown, no extra text):
{
  "paragraphs": [
    { "text": "paragraph text with ", "cites": ["DOC-REF-1"], "tail": " rest of sentence after cites." }
  ],
  "sources": [
    { "num": "DOC-REF", "label": "short document title", "src": "Source Name", "url": "https://..." }
  ]
}

Only include documents in sources that you actually cited. Limit sources to the 4 most relevant.`

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '{}'
  const clean = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()

  try {
    return JSON.parse(clean)
  } catch {
    return {
      paragraphs: [{ text: 'Unable to synthesise answer from available documents.', cites: [], tail: '' }],
      sources: [],
    }
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
router.post('/', async c => {
  const { query } = await c.req.json<{ query: string }>()
  if (!query?.trim()) return c.json({ error: 'query is required' }, 400)

  const relevant = await retrieveReleases(query.trim())
  const answer = await synthesise(query.trim(), relevant)

  return c.json({ answer, sourceCount: relevant.length })
})

export default router
