import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import metricsRouter from './routes/metrics.js'
import forumsRouter from './routes/forums.js'
import topicsRouter from './routes/topics.js'
import askRouter from './routes/ask.js'
import scraperRouter from './routes/scraper.js'
import releasesRouter from './routes/releases.js'
import pressAskRouter from './routes/pressAsk.js'

const app = new Hono()

// Middleware
app.use('*', logger())
app.use(
  '*',
  cors({
    origin: (origin) => origin ?? '*',
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }),
)

// Health check
app.get('/health', c => c.json({ status: 'ok', timestamp: new Date().toISOString() }))

// Routes
app.route('/api/metrics', metricsRouter)
app.route('/api/forums', forumsRouter)
app.route('/api/topics', topicsRouter)
app.route('/api/ask/community', askRouter)
app.route('/api/ask/press', pressAskRouter)
app.route('/api/scraper', scraperRouter)
app.route('/api/releases', releasesRouter)

export default app
