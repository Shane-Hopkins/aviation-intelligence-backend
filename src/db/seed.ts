// Inserts the initial forum and press-source lists.
// Safe to re-run — press sources use onConflictDoNothing on the unique code column.
import 'dotenv/config'
import { db, pool } from './client.js'
import { forums, pressSources } from './schema.js'
import { sql } from 'drizzle-orm'

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
]

const initialPressSources = [
  {
    name: 'EASA — Newsroom',
    code: 'EASA',
    url: 'https://www.easa.europa.eu/en/newsroom-and-events/press-releases',
    scraperType: 'easa',
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
  {
    name: 'Air Ambulances UK',
    code: 'AAUK',
    url: 'https://www.airambulancesuk.org',
    scraperType: 'airambulancesuk',
  },
  {
    name: 'Airborne Technologies',
    code: 'ABT',
    url: 'https://www.airbornetechnologies.at/en/news/',
    scraperType: 'airborne',
  },
  {
    name: 'Air Methods',
    code: 'AIRM',
    url: 'https://www.airmethods.com/press-releases/',
    scraperType: 'airmethods',
  },
  {
    name: 'Archer Aviation',
    code: 'ACHR',
    url: 'https://news.archer.com',
    scraperType: 'archer',
  },
  {
    name: 'ATSB — Australian Transport Safety Bureau',
    code: 'ATSB',
    url: 'https://www.atsb.gov.au/atsb-news',
    scraperType: 'atsb',
  },
  {
    name: 'Bell Flight — Newsroom',
    code: 'BELL',
    url: 'https://news.bellflight.com/en-US/releases/?tags=press-release',
    scraperType: 'bell',
  },
  {
    name: 'Cornwall Air Ambulance Trust',
    code: 'CAAT',
    url: 'https://cornwallairambulancetrust.org/news/',
    scraperType: 'cornwallaa',
  },
  {
    name: 'CAE — Media Centre',
    code: 'CAE',
    url: 'https://www.cae.com/media-centre/press-releases',
    scraperType: 'cae',
  },
  {
    name: 'Enstrom Helicopter',
    code: 'ENS',
    url: 'https://enstromhelicopter.com/category/press-releases/',
    scraperType: 'enstrom',
  },
  {
    name: 'GAMA — General Aviation Manufacturers Association',
    code: 'GAMA',
    url: 'https://gama.aero/news-and-events/press-releases/',
    scraperType: 'gama',
  },
  {
    name: 'Helicopter Investor',
    code: 'HI',
    url: 'https://www.helicopterinvestor.com/news/',
    scraperType: 'helicopterinvestor',
  },
  {
    name: 'ITP Aero — News',
    code: 'ITPA',
    url: 'https://www.itpaero.com/en/news/',
    scraperType: 'itpaero',
  },
  {
    name: 'Joby Aviation — News',
    code: 'JOBY',
    url: 'https://www.jobyaviation.com/news',
    scraperType: 'joby',
  },
  {
    name: 'Leonardo Helicopters — Media Hub',
    code: 'LDO',
    url: 'https://helicopters.leonardo.com/en/media-hub/press-releases',
    scraperType: 'leonardo',
  },
  {
    name: 'Loft Dynamics — News',
    code: 'LOFT',
    url: 'https://www.loftdynamics.com/feed/',
    scraperType: 'loftdynamics',
  },
  {
    name: 'MD Helicopters — Press Releases',
    code: 'MDH',
    url: 'https://www.mdhelicopters.com/category/press-releases/',
    scraperType: 'mdhelicopters',
  },
  {
    name: 'Metro Aviation — News',
    code: 'METRO',
    url: 'https://www.metroaviation.com/metro-media/',
    scraperType: 'metroaviation',
  },
  {
    name: 'Milestone Aviation — Press Releases',
    code: 'MILE',
    url: 'https://www.milestoneaviation.com/media-center/press-releases',
    scraperType: 'milestoneaviation',
  },
  {
    name: 'NBAA — Press Releases',
    code: 'NBAA',
    url: 'https://nbaa.org/press-releases/',
    scraperType: 'nbaa',
  },
  {
    name: 'Omni Helicopters International — News',
    code: 'OHI',
    url: 'https://www.omnihelicoptersinternational.com/all-news/?category=press-release',
    scraperType: 'omnihelicopters',
  },
  {
    name: 'AP News — Helicopter',
    code: 'APN',
    url: 'https://apnews.com/search?q=helicopter&s=3',
    scraperType: 'apnews',
  },
]

async function main() {
  console.log('Seeding forums…')
  for (const forum of initialForums) {
    await db.insert(forums).values(forum).onConflictDoUpdate({
      target: forums.handle,
      set: { name: sql`excluded.name`, url: sql`excluded.url` },
    })
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
