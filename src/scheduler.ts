import cron from 'node-cron'
import { runAllScrapers } from './scrapers/runner.js'
import { runAllPressSources } from './press/runner.js'

const intervalMinutes     = Number(process.env.SCRAPE_INTERVAL_MINUTES ?? 15)
const pressIntervalMinutes = Number(process.env.PRESS_INTERVAL_MINUTES  ?? 60)

function buildCronExpression(minutes: number): string {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
    return `0 */${hours} * * *`
  }
  return `*/${minutes} * * * *`
}

export function startScheduler(): void {
  const forumExpr = buildCronExpression(intervalMinutes)
  console.log(`[scheduler] Forum scraper:  every ${intervalMinutes} minutes (${forumExpr})`)
  cron.schedule(forumExpr, async () => {
    console.log('[scheduler] Triggering forum scrape run…')
    try { await runAllScrapers() } catch (err) { console.error('[scheduler] Forum run failed:', err) }
  })

  const pressExpr = buildCronExpression(pressIntervalMinutes)
  console.log(`[scheduler] Press scraper:  every ${pressIntervalMinutes} minutes (${pressExpr})`)
  cron.schedule(pressExpr, async () => {
    console.log('[scheduler] Triggering press scrape run…')
    try { await runAllPressSources() } catch (err) { console.error('[scheduler] Press run failed:', err) }
  })
}
