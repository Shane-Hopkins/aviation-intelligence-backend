// Topic aggregation — after sentiment analysis, cluster posts by the
// regulatory document they reference, compute per-topic stats, and ask Claude
// to identify the dominant discussion theme for each topic.
import Anthropic from '@anthropic-ai/sdk'
import { db } from '../db/client.js'
import { posts, sentimentAnalyses, topics } from '../db/schema.js'
import { eq, isNotNull } from 'drizzle-orm'

const client = new Anthropic()

// Known press release documents — derived from the pipeline press feed.
// In production this list is fetched from the press release database.
// The key is the doc ref; the value is the human-readable title.
const KNOWN_DOCS: Record<string, string> = {
  'AD-2026-12-08': 'Bell 429 main rotor gearbox AD',
  'EASA-NPA-2026-04': 'EASA BVLOS drone consultation',
  'TC-CASA-2026-117': 'Hydrogen-electric Dash 8 certification',
  'FAA-2026-0944': 'Part 121 cargo crew rest rule',
  'EASA-SIB-2026-09': 'Lithium battery cargo fire bulletin',
  'TC-AD-CF-2026-22': 'De Havilland DHC-6 fuel line directive',
}

// Net sentiment label from a score
function sentimentLabel(net: number): string {
  if (net >= 50) return 'Very positive'
  if (net >= 20) return 'Positive'
  if (net >= 5) return 'Slightly positive'
  if (net > -5) return 'Mixed'
  if (net > -20) return 'Slightly concerned'
  if (net > -50) return 'Concerned'
  return 'Very concerned'
}

// ---------------------------------------------------------------------------
// Ask Claude for the dominant discussion theme for a topic given sample posts
// ---------------------------------------------------------------------------
async function getDominantTheme(
  docRef: string,
  docTitle: string,
  sampleSummaries: string[],
): Promise<string> {
  if (sampleSummaries.length === 0) return 'General discussion'

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 100,
    messages: [
      {
        role: 'user',
        content: `Based on these forum post summaries about "${docTitle}" (${docRef}), write a single short phrase (6-12 words) describing the dominant discussion theme:

${sampleSummaries.slice(0, 15).join('\n')}

Reply with just the phrase, no punctuation at the end, no quotes.`,
      },
    ],
  })

  const text = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
  return text || 'General discussion'
}

// ---------------------------------------------------------------------------
// Rebuild all topics from the current sentiment_analyses data
// ---------------------------------------------------------------------------
export async function rebuildTopics(): Promise<void> {
  // Get all analysed posts that mention a document reference
  const analysed = await db
    .select({
      postId: sentimentAnalyses.postId,
      tone: sentimentAnalyses.tone,
      score: sentimentAnalyses.score,
      docRefs: sentimentAnalyses.docRefs,
      summary: sentimentAnalyses.summary,
      forumId: posts.forumId,
    })
    .from(sentimentAnalyses)
    .innerJoin(posts, eq(posts.id, sentimentAnalyses.postId))
    .where(isNotNull(sentimentAnalyses.docRefs))

  // Group posts by doc ref
  const docGroups = new Map<string, typeof analysed>()

  for (const row of analysed) {
    if (!row.docRefs) continue
    const refs = row.docRefs.split(',').map(r => r.trim()).filter(Boolean)
    for (const ref of refs) {
      const existing = docGroups.get(ref) ?? []
      existing.push(row)
      docGroups.set(ref, existing)
    }
  }

  for (const [docRef, docPosts] of docGroups) {
    const title = KNOWN_DOCS[docRef] ?? `Discussion: ${docRef}`

    // Aggregate sentiment
    const pos = docPosts.filter(p => p.tone === 'pos').length
    const neu = docPosts.filter(p => p.tone === 'neu').length
    const neg = docPosts.filter(p => p.tone === 'neg').length
    const total = docPosts.length

    const avgScore = docPosts.reduce((sum, p) => sum + (p.score ?? 0), 0) / total
    const netSentiment = Math.round(avgScore)

    // Count distinct forums
    const forumSet = new Set(docPosts.map(p => p.forumId))

    // Get theme from Claude (using summaries)
    const summaries = docPosts.map(p => p.summary ?? '').filter(Boolean)
    const dominantTheme = await getDominantTheme(docRef, title, summaries)

    // Top forums — we'd need to join forum names here; for now use IDs as placeholder
    // In production, join with forums table to get names
    const topForums = [...forumSet].slice(0, 3).join(',')

    // Upsert topic
    await db
      .insert(topics)
      .values({
        docRef,
        title,
        posCount: pos,
        neuCount: neu,
        negCount: neg,
        postCount: total,
        forumCount: forumSet.size,
        netSentiment,
        sentimentLabel: sentimentLabel(netSentiment),
        dominantTheme,
        topForums,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: topics.docRef,
        set: {
          title,
          posCount: pos,
          neuCount: neu,
          negCount: neg,
          postCount: total,
          forumCount: forumSet.size,
          netSentiment,
          sentimentLabel: sentimentLabel(netSentiment),
          dominantTheme,
          topForums,
          updatedAt: new Date(),
        },
      })

    console.log(`[topics] ${docRef}: ${total} posts, net ${netSentiment} (${sentimentLabel(netSentiment)})`)
  }
}
