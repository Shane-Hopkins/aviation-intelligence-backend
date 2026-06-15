// Inserts the initial forum and press-source lists.
// Safe to re-run — press sources use onConflictDoNothing on the unique code column.
import 'dotenv/config'
import { db, pool } from './client.js'
import { forums, pressSources } from './schema.js'

const initialForums = [
  {
    name: 'Reddit r/aviation',
    handle: 'r/aviation',
    url: 'https://www.reddit.com/r/aviation',
    scraperType: 'reddit',
    scraperConfig: JSON.stringify({ subreddit: 'aviation' }),
  },
  {
    name: 'Reddit r/flying',
    handle: 'r/flying',
    url: 'https://www.reddit.com/r/flying',
    scraperType: 'reddit',
    scraperConfig: JSON.stringify({ subreddit: 'flying' }),
  },
  {
    name: 'Reddit r/drones',
    handle: 'r/drones',
    url: 'https://www.reddit.com/r/drones',
    scraperType: 'reddit',
    scraperConfig: JSON.stringify({ subreddit: 'drones' }),
  },
  {
    name: 'PPRuNe',
    handle: 'pprune.org',
    url: 'https://www.pprune.org',
    scraperType: 'pprune',
    scraperConfig: JSON.stringify({ sectionPaths: ['/rumours-news/', '/tech-log/'] }),
  },
  {
    name: 'Rotorheads',
    handle: 'pprune · rotor',
    url: 'https://www.pprune.org',
    scraperType: 'pprune',
    scraperConfig: JSON.stringify({ sectionPaths: ['/rotorheads/'] }),
  },
  {
    name: 'Airliners.net',
    handle: 'airliners.net',
    url: 'https://www.airliners.net',
    scraperType: 'airliners',
    scraperConfig: JSON.stringify({ forumIds: [1, 2, 3] }),
  },
  {
    name: 'StuckMic (ATC)',
    handle: 'stuckmic.com',
    url: 'https://www.stuckmic.com',
    scraperType: 'stuckmic',
    scraperConfig: JSON.stringify({}),
  },
  {
    name: 'Pilots of America',
    handle: 'pilotsofamerica.com',
    url: 'https://www.pilotsofamerica.com',
    scraperType: 'pilotsofamerica',
    scraperConfig: JSON.stringify({}),
  },
]

const initialPressSources = [
  {
    name: 'FAA — Federal Register',
    code: 'FAA',
    url: 'https://www.federalregister.gov',
    scraperType: 'faa',
  },
  {
    name: 'EASA — Newsroom',
    code: 'EASA',
    url: 'https://www.easa.europa.eu/en/newsroom-and-events/press-releases',
    scraperType: 'easa',
  },
  {
    name: 'Transport Canada — Civil Aviation',
    code: 'TC',
    url: 'https://tc.canada.ca/en/corporate-services/news-communications/news-releases',
    scraperType: 'tc',
  },
  {
    name: 'Boeing — Media Room',
    code: 'BA',
    url: 'https://boeing.mediaroom.com/news-releases-statements',
    scraperType: 'boeing',
  },
  {
    name: 'Airbus — Newsroom',
    code: 'AB',
    url: 'https://www.airbus.com/en/newsroom/press-releases',
    scraperType: 'airbus',
  },
  {
    name: 'ICAO — Newsroom',
    code: 'ICAO',
    url: 'https://www.icao.int/Newsroom/Pages/default.aspx',
    scraperType: 'icao',
  },
]

async function main() {
  console.log('Seeding forums…')
  for (const forum of initialForums) {
    await db.insert(forums).values(forum).onConflictDoNothing()
  }
  console.log(`Seeded ${initialForums.length} forums.`)

  console.log('Seeding press sources…')
  for (const source of initialPressSources) {
    await db.insert(pressSources).values(source).onConflictDoNothing()
  }
  console.log(`Seeded ${initialPressSources.length} press sources.`)

  await pool.end()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
