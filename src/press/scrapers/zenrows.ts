// ZenRows proxy helper — used for sites that block data-centre IPs.
// Set ZENROWS_API_KEY in the server environment to enable.
// Falls back to a direct fetch if the env var is not set.

const BASE = 'https://api.zenrows.com/v1/'

export async function zenFetch(
  url: string,
  options: { jsRender?: boolean; premiumProxy?: boolean; wait?: number; waitFor?: string } = {},
): Promise<Response> {
  const apiKey = process.env.ZENROWS_API_KEY
  if (!apiKey) {
    // No key configured — attempt direct fetch (may fail on protected sites)
    return fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AviationPress/1.0)', Accept: 'text/html' },
      signal: AbortSignal.timeout(15_000),
    })
  }

  const params = new URLSearchParams({ apikey: apiKey, url })
  if (options.jsRender)    params.set('js_render', 'true')
  if (options.premiumProxy) params.set('premium_proxy', 'true')
  if (options.wait)        params.set('wait', String(options.wait))
  if (options.waitFor)     params.set('wait_for', options.waitFor)

  // js_render spins up a headless browser — allow up to 90s (extra for wait param)
  const timeout = options.jsRender ? 90_000 : 30_000
  return fetch(`${BASE}?${params}`, {
    signal: AbortSignal.timeout(timeout),
  })
}
