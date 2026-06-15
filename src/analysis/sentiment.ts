// Sentiment analysis — uses Claude to score each post's tone, detect
// aviation regulatory document references, and generate a short summary.
// Posts are batched (25 per Claude call) to balance accuracy and cost.
import Anthropic from '@anthropic-ai/sdk'
import { db } from '../db/client.js'
import { posts, sentimentAnalyses } from '../db/schema.js'
import { inArray } from 'drizzle-orm'

const client = new Anthropic()
const BATCH_SIZE = 25

interface PostAnalysis {
  externalId: string
  tone: 'pos' | 'neu' | 'neg'
  score: number
  docRefs: string[]
  summary: string
}

// ---------------------------------------------------------------------------
// Build the Claude prompt for a batch of posts
// ---------------------------------------------------------------------------
function buildPrompt(
  batch: Array<{ externalId: string; threadTitle: string | null; content: string }>,
): string {
  return `You are an aviation industry analyst. Analyze the following forum posts for sentiment about aviation regulations, safety directives, and industry news.

For each post, return:
- tone: "pos" (positive/supportive/enthusiastic), "neu" (neutral/informational/balanced), or "neg" (negative/critical/concerned/angry)
- score: integer -100 (most negative) to +100 (most positive), 0 for purely neutral
- docRefs: array of any aviation regulatory document numbers explicitly mentioned (e.g. "AD-2026-12-08", "EASA-NPA-2026-04", "FAA-2026-0944", "TC-CASA-2026-117", "EASA-SIB-2026-09"). Empty array [] if none found.
- summary: one concise sentence describing the post's main point

Respond with a JSON array only — no markdown, no explanation. One object per post, in the same order as the input. Each object must have the fields: externalId, tone, score, docRefs, summary.

Posts to analyze:
${JSON.stringify(
  batch.map(p => ({
    externalId: p.externalId,
    threadTitle: p.threadTitle ?? '',
    content: p.content.slice(0, 800), // keep prompt manageable
  })),
  null,
  2,
)}`
}

// ---------------------------------------------------------------------------
// Call Claude and parse the JSON response
// ---------------------------------------------------------------------------
async function callClaude(
  batch: Array<{ externalId: string; threadTitle: string | null; content: string }>,
): Promise<PostAnalysis[]> {
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{ role: 'user', content: buildPrompt(batch) }],
  })

  const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '[]'

  // Strip markdown code fences if Claude wrapped the JSON
  const clean = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()

  try {
    const parsed = JSON.parse(clean) as PostAnalysis[]
    // Validate and clamp
    return parsed.map(p => ({
      externalId: String(p.externalId),
      tone: ['pos', 'neu', 'neg'].includes(p.tone) ? p.tone : 'neu',
      score: Math.max(-100, Math.min(100, Math.round(Number(p.score) || 0))),
      docRefs: Array.isArray(p.docRefs) ? p.docRefs.map(String) : [],
      summary: String(p.summary || ''),
    }))
  } catch {
    console.error('[sentiment] Failed to parse Claude response:', text.slice(0, 200))
    // Return neutral defaults so the run doesn't fail completely
    return batch.map(p => ({
      externalId: p.externalId,
      tone: 'neu' as const,
      score: 0,
      docRefs: [],
      summary: 'Analysis unavailable.',
    }))
  }
}

// ---------------------------------------------------------------------------
// Analyse a list of post IDs that haven't been scored yet
// ---------------------------------------------------------------------------
export async function analyseNewPosts(postIds: number[]): Promise<void> {
  // Fetch the post rows
  const postRows = await db.query.posts.findMany({
    where: inArray(posts.id, postIds),
  })

  if (postRows.length === 0) return

  // Process in batches
  for (let i = 0; i < postRows.length; i += BATCH_SIZE) {
    const batch = postRows.slice(i, i + BATCH_SIZE)

    const analyses = await callClaude(
      batch.map(p => ({
        externalId: p.externalId,
        threadTitle: p.threadTitle,
        content: p.content,
      })),
    )

    // Build a map from externalId → DB post id
    const idMap = new Map(batch.map(p => [p.externalId, p.id]))

    for (const analysis of analyses) {
      const postId = idMap.get(analysis.externalId)
      if (!postId) continue

      await db
        .insert(sentimentAnalyses)
        .values({
          postId,
          tone: analysis.tone,
          score: analysis.score,
          docRefs: analysis.docRefs.join(','),
          summary: analysis.summary,
        })
        .onConflictDoNothing() // idempotent — skip if already analysed
    }

    // Pause between batches to respect rate limits
    if (i + BATCH_SIZE < postRows.length) {
      await new Promise(r => setTimeout(r, 1000))
    }
  }
}
