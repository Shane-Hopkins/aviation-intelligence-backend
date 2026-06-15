import { Hono } from 'hono'
import { db } from '../../db/client.js'
import { topics, topicPosts, posts, forums, sentimentAnalyses } from '../../db/schema.js'
import { eq, desc } from 'drizzle-orm'

const router = new Hono()

// GET /api/topics
// Returns all topics with aggregated sentiment data, sorted by post volume.
// Shape matches what the Community Pulse frontend expects.
router.get('/', async c => {
  const allTopics = await db.query.topics.findMany({
    orderBy: t => desc(t.postCount),
  })

  // Compute percentage breakdowns
  const result = allTopics.map(t => {
    const total = t.postCount || 1 // avoid div/0
    const pos = Math.round((t.posCount / total) * 100)
    const neg = Math.round((t.negCount / total) * 100)
    const neu = 100 - pos - neg

    const net = t.netSentiment ?? 0
    const tone = net >= 15 ? 'pos' : net <= -15 ? 'neg' : 'neu'

    return {
      id: t.id,
      title: t.title,
      doc: t.docRef,
      posts: t.postCount.toLocaleString(),
      forums: t.forumCount,
      pos,
      neu,
      neg,
      net: Math.round(net),
      label: t.sentimentLabel,
      tone,
      theme: t.dominantTheme ?? 'General discussion',
      top: (t.topForums ?? '').split(',').filter(Boolean),
      updatedAt: t.updatedAt,
    }
  })

  return c.json({ topics: result })
})

// GET /api/topics/:docRef — single topic with sample posts
router.get('/:docRef', async c => {
  const docRef = c.req.param('docRef')
  const topic = await db.query.topics.findFirst({ where: eq(topics.docRef, docRef) })
  if (!topic) return c.json({ error: 'Not found' }, 404)

  // Get up to 20 sample posts for this topic with their sentiment
  const samplePosts = await db
    .select({
      id: posts.id,
      threadTitle: posts.threadTitle,
      content: posts.content,
      author: posts.author,
      url: posts.url,
      postedAt: posts.postedAt,
      tone: sentimentAnalyses.tone,
      score: sentimentAnalyses.score,
      summary: sentimentAnalyses.summary,
      forumName: forums.name,
    })
    .from(topicPosts)
    .innerJoin(posts, eq(posts.id, topicPosts.postId))
    .innerJoin(forums, eq(forums.id, posts.forumId))
    .leftJoin(sentimentAnalyses, eq(sentimentAnalyses.postId, posts.id))
    .where(eq(topicPosts.topicId, topic.id))
    .orderBy(desc(posts.postedAt))
    .limit(20)

  return c.json({ topic, posts: samplePosts })
})

export default router
