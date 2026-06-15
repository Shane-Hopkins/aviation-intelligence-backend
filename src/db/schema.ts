import { pgTable, serial, text, integer, real, boolean, timestamp, unique } from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// Forums — the list of sources we monitor. Add new forums here or via the
// dashboard API (POST /api/forums). scraperConfig is JSON-encoded per-scraper
// options (e.g. { subreddit: "aviation" } or { sectionUrl: "/rotorheads/" }).
// ---------------------------------------------------------------------------
export const forums = pgTable('forums', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  handle: text('handle').notNull(),
  url: text('url').notNull(),
  scraperType: text('scraper_type').notNull(), // 'reddit' | 'pprune' | 'airliners' | 'stuckmic' | 'pilotsofamerica'
  scraperConfig: text('scraper_config'), // JSON string, shape depends on scraperType
  status: text('status').notNull().default('healthy'), // 'healthy' | 'degraded' | 'down'
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Posts — individual posts or threads scraped from forums. content is the
// full text (or first ~2000 chars) of the post. externalId is unique per forum.
// ---------------------------------------------------------------------------
export const posts = pgTable('posts', {
  id: serial('id').primaryKey(),
  forumId: integer('forum_id').references(() => forums.id).notNull(),
  externalId: text('external_id').notNull(),
  threadId: text('thread_id'),
  threadTitle: text('thread_title'),
  content: text('content').notNull(),
  author: text('author'),
  url: text('url'),
  postedAt: timestamp('posted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, t => ({
  forumPostUniq: unique().on(t.forumId, t.externalId),
}))

// ---------------------------------------------------------------------------
// Sentiment analyses — Claude's per-post analysis. One row per post once
// analysed. docRefs is a comma-separated list of regulatory document numbers
// Claude detected in the post (e.g. "AD-2026-12-08,FAA-2026-0944").
// ---------------------------------------------------------------------------
export const sentimentAnalyses = pgTable('sentiment_analyses', {
  id: serial('id').primaryKey(),
  postId: integer('post_id').references(() => posts.id).notNull().unique(),
  tone: text('tone').notNull(), // 'pos' | 'neu' | 'neg'
  score: real('score').notNull(), // -100 to +100
  docRefs: text('doc_refs'), // comma-separated, empty string if none
  summary: text('summary').notNull(),
  analysedAt: timestamp('analysed_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Topics — aggregated discussion topics, each tied to a press release doc.
// Rebuilt by the analysis pipeline after each scrape run.
// ---------------------------------------------------------------------------
export const topics = pgTable('topics', {
  id: serial('id').primaryKey(),
  docRef: text('doc_ref').notNull().unique(), // e.g. 'AD-2026-12-08'
  title: text('title').notNull(),
  posCount: integer('pos_count').notNull().default(0),
  neuCount: integer('neu_count').notNull().default(0),
  negCount: integer('neg_count').notNull().default(0),
  postCount: integer('post_count').notNull().default(0),
  forumCount: integer('forum_count').notNull().default(0),
  netSentiment: real('net_sentiment').notNull().default(0),
  sentimentLabel: text('sentiment_label').notNull().default('Mixed'),
  dominantTheme: text('dominant_theme'),
  topForums: text('top_forums'), // comma-separated top 3 forum names
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Topic posts — which posts belong to which topic (many-to-many).
// ---------------------------------------------------------------------------
export const topicPosts = pgTable('topic_posts', {
  topicId: integer('topic_id').references(() => topics.id).notNull(),
  postId: integer('post_id').references(() => posts.id).notNull(),
}, t => ({
  pk: unique().on(t.topicId, t.postId),
}))

// ---------------------------------------------------------------------------
// Scraper runs — audit log for every scheduled scrape run.
// ---------------------------------------------------------------------------
export const scraperRuns = pgTable('scraper_runs', {
  id: serial('id').primaryKey(),
  forumId: integer('forum_id').references(() => forums.id).notNull(),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
  itemsCollected: integer('items_collected').notNull().default(0),
  status: text('status').notNull().default('running'), // 'running' | 'ok' | 'warn' | 'err'
  error: text('error'),
})

export type Forum = typeof forums.$inferSelect
export type NewForum = typeof forums.$inferInsert
export type Post = typeof posts.$inferSelect
export type NewPost = typeof posts.$inferInsert
export type SentimentAnalysis = typeof sentimentAnalyses.$inferSelect
export type Topic = typeof topics.$inferSelect
export type ScraperRun = typeof scraperRuns.$inferSelect

// ---------------------------------------------------------------------------
// Press sources — regulatory bodies and OEM newsrooms scraped for releases.
// ---------------------------------------------------------------------------
export const pressSources = pgTable('press_sources', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  code: text('code').notNull().unique(), // 'FAA' | 'EASA' | 'TC' | 'BA' | 'AB' | 'ICAO'
  url: text('url').notNull(),
  scraperType: text('scraper_type').notNull(),
  status: text('status').notNull().default('healthy'), // 'healthy' | 'degraded' | 'down'
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Press releases — individual documents scraped from press sources.
// content holds headline + abstract/blurb for Claude to summarise.
// ---------------------------------------------------------------------------
export const pressReleases = pgTable('press_releases', {
  id: serial('id').primaryKey(),
  sourceId: integer('source_id').references(() => pressSources.id).notNull(),
  externalId: text('external_id').notNull(),
  docRef: text('doc_ref'),           // e.g. 'AD-2026-12-08', null if not parsed
  headline: text('headline').notNull(),
  url: text('url'),
  publishedAt: timestamp('published_at'),
  content: text('content'),          // excerpt / abstract for AI summarisation
  imageUrl: text('image_url'),       // og:image or first article image
  fullContent: text('full_content'), // full scraped article body text
  category: text('category'),        // 'Safety' | 'Regulation' | 'Industry' — set by AI
  jurisdiction: text('jurisdiction'),
  effectiveDate: text('effective_date'),
  aiSummary: text('ai_summary'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, t => ({
  sourceReleaseUniq: unique().on(t.sourceId, t.externalId),
}))

// ---------------------------------------------------------------------------
// Press scraper runs — audit log for every press scrape run.
// ---------------------------------------------------------------------------
export const pressScraperRuns = pgTable('press_scraper_runs', {
  id: serial('id').primaryKey(),
  sourceId: integer('source_id').references(() => pressSources.id).notNull(),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
  itemsCollected: integer('items_collected').notNull().default(0),
  status: text('status').notNull().default('running'), // 'running' | 'ok' | 'warn' | 'err'
  error: text('error'),
})

export type PressSource = typeof pressSources.$inferSelect
export type PressRelease = typeof pressReleases.$inferSelect
export type PressScraperRun = typeof pressScraperRuns.$inferSelect
