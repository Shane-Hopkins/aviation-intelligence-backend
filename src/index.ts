import 'dotenv/config'
import { serve } from '@hono/node-server'
import app from './api/index.js'
import { startScheduler } from './scheduler.js'

const port = Number(process.env.PORT ?? 3001)

serve({ fetch: app.fetch, port }, info => {
  console.log(`[api] Aviation Intelligence backend running on http://localhost:${info.port}`)
  console.log(`[api] Health: http://localhost:${info.port}/health`)
})

startScheduler()

// Run initial scrapes shortly after startup so the DB isn't empty.
// Skip if NO_INITIAL_SCRAPE=true (useful in development when data already exists).
if (process.env.NO_INITIAL_SCRAPE !== 'true') {
  console.log('[scraper] Initial forum scrape will start in 10s…')
  setTimeout(() => {
    import('./scrapers/runner.js').then(({ runAllScrapers }) => {
      runAllScrapers().catch(console.error)
    })
  }, 10_000)

  console.log('[press] Initial press scrape will start in 30s…')
  setTimeout(() => {
    import('./press/runner.js').then(({ runAllPressSources }) => {
      runAllPressSources().catch(console.error)
    })
  }, 30_000)
}
