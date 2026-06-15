// POST /api/ask/community
// RAG endpoint for the "Ask the community" panel.
// Retrieves relevant forum posts, then synthesises an answer with Claude
// that cites the actual discussion threads.
import { Hono } from 'hono'
import Anthropic from '@anthropic-ai/sdk'
import { db } from '../../db/client.js'
import { posts, sentimentAnalyses, forums } from '../../db/schema.js'
import { sql, gte, eq, desc } from 'drizzle-orm'

const router = new Hono()
const client = new Anthropic()

interface CitedSource {
  num: string
  label: string
  src: string
  url: string
}

interface AnswerParagraph {
  text: string
  cites: string[]
  tail: string
}

// ---------------------------------------------------------------------------
// Keyword search over post content using PostgreSQL full-text search
// (falls back to ILIKE if the ts_vector index isn't available yet)
// ---------------------------------------------------------------------------
async function retrieveRelevantPosts(query: string, limit = 30) {
  const sevenDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  // Simple keyword approach using ILIKE — works without any FTS setup
  const keywords = query
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3)
    .slice(0, 6)

  if (keywords.length === 0) {
    // Fall back to recent posts
    return db
      .select({
        id: posts.id,
        threadTitle: posts.threadTitle,
        content: posts.content,
        url: posts.url,
        tone: sentimentAnalyses.tone,
        score: sentimentAnalyses.score,
        summary: sentimentAnalyses.summary,
        docRefs: sentimentAnalyses.docRefs,
        forumName: forums.name,
        forumHandle: forums.handle,
      })
      .from(posts)
      .innerJoin(forums, eq(forums.id, posts.forumId))
      .leftJoin(sentimentAnalyses, eq(sentimentAnalyses.postId, posts.id))
      .where(gte(posts.postedAt, sevenDaysAgo))
      .orderBy(desc(posts.postedAt))
      .limit(limit)
  }

  // Build ILIKE conditions for each keyword
  const conditions = keywords.map(
    kw => sql`(lower(posts.content) like ${'%' + kw + '%'} or lower(posts.thread_title) like ${'%' + kw + '%'})`,
  )

  return db
    .select({
      id: posts.id,
      threadTitle: posts.threadTitle,
      content: posts.content,
      url: posts.url,
      tone: sentimentAnalyses.tone,
      score: sentimentAnalyses.score,
      summary: sentimentAnalyses.summary,
      docRefs: sentimentAnalyses.docRefs,
      forumName: forums.name,
      forumHandle: forums.handle,
    })
    .from(posts)
    .innerJoin(forums, eq(forums.id, posts.forumId))
    .leftJoin(sentimentAnalyses, eq(sentimentAnalyses.postId, posts.id))
    .where(sql`${conditions.reduce((acc, c, i) => i === 0 ? c : sql`${acc} or ${c}`)}`)
    .orderBy(desc(posts.postedAt))
    .limit(limit)
}

// ---------------------------------------------------------------------------
// Ask Claude to synthesise an answer from retrieved posts
// ---------------------------------------------------------------------------
async function synthesise(
  query: string,
  relevantPosts: Awaited<ReturnType<typeof retrieveRelevantPosts>>,
): Promise<{ paragraphs: AnswerParagraph[]; sources: CitedSource[] }> {
  if (relevantPosts.length === 0) {
    return {
      paragraphs: [{ text: 'No relevant forum discussions found for that query.', cites: [], tail: '' }],
      sources: [],
    }
  }

  const context = relevantPosts.map((p, i) => ({
    index: i + 1,
    ref: `Thread #${p.id}`,
    forum: p.forumName,
    title: p.threadTitle ?? '',
    summary: p.summary ?? p.content.slice(0, 200),
    tone: p.tone ?? 'neu',
    score: p.score ?? 0,
    url: p.url ?? '',
  }))

  const prompt = `You are an aviation intelligence analyst answering a user's question about community sentiment.

User question: "${query}"

You have access to ${context.length} relevant forum discussion posts. Use them to write a clear, factual 2-3 paragraph answer that:
- Directly addresses the question
- Cites specific threads inline using the format [ref: "Thread #N"] where N is the index number
- Describes the overall sentiment and key themes
- Stays grounded in what the forum posts actually say

Forum discussions (indexed for citation):
${JSON.stringify(context, null, 2)}

Respond with JSON only in this exact shape (no markdown, no extra text):
{
  "paragraphs": [
    { "text": "paragraph text with ", "cites": ["Thread #1", "Thread #3"], "tail": " rest of sentence after cites." }
  ],
  "sources": [
    { "num": "Thread #N", "label": "thread title", "src": "Forum Name", "url": "https://..." }
  ]
}

Only include threads in sources that you actually cited. Keep sources to the 3-5 most relevant.`

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
      paragraphs: [{ text: 'Unable to synthesise answer from available discussions.', cites: [], tail: '' }],
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

  const relevant = await retrieveRelevantPosts(query.trim())
  const answer = await synthesise(query.trim(), relevant)

  return c.json({
    answer,
    sourceCount: relevant.length,
  })
})

export default router
