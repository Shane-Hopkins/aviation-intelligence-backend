// Topic aggregation — after sentiment analysis, cluster posts by thread,
// compute per-topic sentiment stats, and surface the most-discussed threads.
import { db } from '../db/client.js'
import { posts, sentimentAnalyses, topics, forums } from '../db/schema.js'
import { eq, gte, desc, sql } from 'drizzle-orm'

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
// Rebuild topics by grouping analysed posts by thread (last 30 days).
// Each thread with at least 1 analysed post becomes a topic row.
// ---------------------------------------------------------------------------
export async function rebuildTopics(): Promise<void> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  // Aggregate per threadId: sentiment stats + forum membership
  const rows = await db
    .select({
      threadId: posts.threadId,
      threadTitle: posts.threadTitle,
      forumId: posts.forumId,
      forumName: forums.name,
      postCount:  sql<number>`count(distinct ${posts.id})`,
      posCount:   sql<number>`sum(case when ${sentimentAnalyses.tone} = 'pos' then 1 else 0 end)`,
      neuCount:   sql<number>`sum(case when ${sentimentAnalyses.tone} = 'neu' then 1 else 0 end)`,
      negCount:   sql<number>`sum(case when ${sentimentAnalyses.tone} = 'neg' then 1 else 0 end)`,
      avgScore:   sql<number>`avg(${sentimentAnalyses.score})`,
    })
    .from(posts)
    .innerJoin(sentimentAnalyses, eq(sentimentAnalyses.postId, posts.id))
    .innerJoin(forums, eq(forums.id, posts.forumId))
    .where(gte(posts.postedAt, thirtyDaysAgo))
    .groupBy(posts.threadId, posts.threadTitle, posts.forumId, forums.name)
    .orderBy(desc(sql`count(distinct ${posts.id})`))
    .limit(50)

  if (rows.length === 0) {
    console.log('[topics] No analysed posts in last 30 days — skipping rebuild')
    return
  }

  // Merge threads with the same title across forums (cross-forum discussion)
  const merged = new Map<string, {
    title: string
    pos: number; neu: number; neg: number; total: number
    scoreSum: number; forums: Set<string>
  }>()

  for (const row of rows) {
    const key = (row.threadTitle ?? row.threadId ?? 'unknown').slice(0, 120)
    const existing = merged.get(key)
    const pos   = Number(row.posCount ?? 0)
    const neu   = Number(row.neuCount ?? 0)
    const neg   = Number(row.negCount ?? 0)
    const total = Number(row.postCount ?? 0)
    const avg   = Number(row.avgScore ?? 0)

    if (existing) {
      existing.pos   += pos
      existing.neu   += neu
      existing.neg   += neg
      existing.total += total
      existing.scoreSum += avg * total
      existing.forums.add(row.forumName ?? 'Unknown')
    } else {
      merged.set(key, {
        title: key,
        pos, neu, neg, total,
        scoreSum: avg * total,
        forums: new Set([row.forumName ?? 'Unknown']),
      })
    }
  }

  // Clear old topics and insert fresh
  await db.delete(topics)

  for (const [key, t] of merged) {
    const netSentiment = t.total > 0 ? Math.round(t.scoreSum / t.total) : 0
    const topForums = [...t.forums].slice(0, 3).join(', ')

    await db.insert(topics).values({
      docRef: key.slice(0, 200),
      title: t.title,
      posCount: t.pos,
      neuCount: t.neu,
      negCount: t.neg,
      postCount: t.total,
      forumCount: t.forums.size,
      netSentiment,
      sentimentLabel: sentimentLabel(netSentiment),
      dominantTheme: topForums,
      topForums,
      updatedAt: new Date(),
    }).onConflictDoNothing()

    console.log(`[topics] "${t.title.slice(0, 60)}": ${t.total} posts, net ${netSentiment}`)
  }

  console.log(`[topics] Rebuilt ${merged.size} topics`)
}
