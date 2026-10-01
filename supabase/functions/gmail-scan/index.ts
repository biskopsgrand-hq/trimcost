import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const REDIRECT_URI = 'https://trimcost.app/app'

// Broad query to find receipts/invoices — body filter below weeds out one-time purchases
function buildGmailQuery(): string {
  return [
    'subscription', 'billing', 'renewal', 'recurring',
    'prenumeration', 'abonnemang', 'förnyelse',
    'receipt', 'invoice', 'kvitto', 'faktura',
    'your plan', 'your membership', 'monthly', 'annual',
    'auto-renew', 'next billing', 'månadsvis',
  ].map(k => `"${k}"`).join(' OR ')
}

// Must contain at least one of these to count as a subscription (not a one-time receipt)
const SUB_INDICATORS = [
  'subscription', 'subscribe', 'recurring', 'renewal', 'renew',
  'monthly', 'annual', 'yearly', 'per month', 'per year', '/month', '/year',
  'prenumeration', 'abonnemang', 'förnyelse', 'automatisk förnyelse',
  'your plan', 'your membership', 'membership', 'member since',
  'billing cycle', 'next billing', 'next charge', 'auto-renew',
  'cancel anytime', 'avsluta när', 'debiteras automatiskt',
  'månadsvis', 'årsvis', 'månadsbetalning',
  // Spotify/Google Swedish receipt bodies
  'din prenumeration', 'ditt konto', 'förnyas automatiskt',
  'nästa fakturadatum', 'nästa betalning', 'din plan',
  'premium', 'family plan', 'individual plan',
]

function isSubscriptionEmail(text: string): boolean {
  const lower = text.toLowerCase()
  return SUB_INDICATORS.some(kw => lower.includes(kw))
}

function extractAmount(text: string): number | null {
  const patterns = [
    // Swedish: 99,00 kr | 99 kr | 99:- kr
    /(\d[\d\s]*[\d])[,.](\d{2})\s*(?:SEK|kr)\b/i,
    /(\d+)\s*kr\b/i,
    /(\d+):-/,
    // International
    /(\d+[\.,]\d{2})\s*(?:SEK|USD|EUR|GBP)/i,
    /(?:SEK|USD|EUR|GBP|\$|€|£)\s*(\d+[\.,]\d{2})/i,
    /(?:\$|€|£)(\d+[\.,]\d{2})/,
    // Label-based
    /(?:total|amount|charged|billed|price|summa|belopp|att betala)[\s:]*(?:[A-Z]{3}\s*)?(\d+[.,]\d{2})/i,
    /(?:total|amount|charged|billed|price|summa|belopp|att betala)[\s:]*(?:[A-Z]{3}\s*)?(\d+)\b/i,
  ]
  for (const p of patterns) {
    const m = text.match(p)
    if (m) {
      // Join digits (may have spaces in Swedish formatting like "1 299")
      const raw = m[1].replace(/\s/g, '') + (m[2] ? '.' + m[2] : '')
      const n = parseFloat(raw.replace(',', '.'))
      if (!isNaN(n)) return n
    }
  }
  return null
}

function extractCurrency(text: string): string {
  if (/\bSEK\b|kr\b/i.test(text)) return 'SEK'
  if (/USD|\$/i.test(text)) return 'USD'
  if (/EUR|€/i.test(text)) return 'EUR'
  if (/GBP|£/i.test(text)) return 'GBP'
  return 'SEK' // Default to SEK for Swedish users
}

// Known subscription services — name fragments matched against merchant name (lowercase)
// min/max = monthly SEK range (annual ÷ 12). max:9999 = any price accepted.
const KNOWN_SERVICES: Array<{ match: string[], min: number, max: number }> = [
  // Streaming — video
  { match: ['spotify'],                                   min: 20,  max: 500  },
  { match: ['netflix'],                                   min: 60,  max: 400  },
  { match: ['disney'],                                    min: 40,  max: 300  },
  { match: ['hbo', 'max streaming', 'warner'],            min: 50,  max: 300  },
  { match: ['viaplay'],                                   min: 50,  max: 500  },
  { match: ['c more', 'cmore'],                           min: 50,  max: 400  },
  { match: ['tv4', 'tv 4'],                               min: 30,  max: 300  },
  { match: ['paramount'],                                  min: 40,  max: 200  },
  { match: ['discovery', 'discoveryplus'],                 min: 40,  max: 200  },
  { match: ['mubi'],                                      min: 60,  max: 150  },
  { match: ['plex'],                                      min: 40,  max: 200  },
  // Streaming — music
  { match: ['tidal'],                                     min: 80,  max: 250  },
  { match: ['deezer'],                                    min: 60,  max: 200  },
  { match: ['apple music', 'apple tv', 'apple one', 'icloud', 'apple'],  min: 10, max: 800 },
  { match: ['youtube', 'youtube premium'],                min: 30,  max: 200  },
  // Books / audio
  { match: ['storytel'],                                  min: 80,  max: 250  },
  { match: ['nextory'],                                   min: 80,  max: 250  },
  { match: ['readly'],                                    min: 80,  max: 200  },
  { match: ['bookbeat'],                                  min: 80,  max: 200  },
  { match: ['audible'],                                   min: 80,  max: 200  },
  { match: ['scribd'],                                    min: 80,  max: 200  },
  // Cloud / storage
  { match: ['google one', 'google play', 'google storage'], min: 10, max: 300 },
  { match: ['dropbox'],                                   min: 50,  max: 800  },
  { match: ['onedrive'],                                  min: 20,  max: 400  },
  { match: ['box.com', 'box inc'],                        min: 80,  max: 600  },
  { match: ['backblaze'],                                 min: 50,  max: 200  },
  { match: ['pcloud'],                                    min: 40,  max: 200  },
  // Productivity / work
  { match: ['microsoft', 'office 365', 'm365'],           min: 20,  max: 1000 },
  { match: ['adobe'],                                     min: 50,  max: 1000 },
  { match: ['notion'],                                    min: 40,  max: 600  },
  { match: ['slack'],                                     min: 50,  max: 1000 },
  { match: ['zoom'],                                      min: 50,  max: 800  },
  { match: ['asana'],                                     min: 80,  max: 1000 },
  { match: ['monday.com', 'monday com'],                  min: 80,  max: 1000 },
  { match: ['trello'],                                    min: 40,  max: 400  },
  { match: ['figma'],                                     min: 80,  max: 800  },
  { match: ['canva'],                                     min: 80,  max: 600  },
  { match: ['loom'],                                      min: 50,  max: 400  },
  { match: ['miro'],                                      min: 80,  max: 800  },
  { match: ['airtable'],                                  min: 80,  max: 800  },
  { match: ['clickup'],                                   min: 50,  max: 600  },
  { match: ['linear'],                                    min: 80,  max: 600  },
  { match: ['jira', 'confluence', 'atlassian'],           min: 50,  max: 2000 },
  // Dev tools
  { match: ['github'],                                    min: 30,  max: 600  },
  { match: ['gitlab'],                                    min: 50,  max: 800  },
  { match: ['cursor'],                                    min: 100, max: 400  },
  { match: ['copilot', 'github copilot'],                 min: 80,  max: 300  },
  { match: ['vercel'],                                    min: 50,  max: 2000 },
  { match: ['netlify'],                                   min: 50,  max: 2000 },
  { match: ['heroku'],                                    min: 50,  max: 2000 },
  { match: ['digitalocean'],                              min: 50,  max: 9999 },
  { match: ['cloudflare'],                                min: 50,  max: 9999 },
  { match: ['supabase'],                                  min: 50,  max: 9999 },
  // AI tools
  { match: ['chatgpt', 'openai'],                         min: 100, max: 400  },
  { match: ['claude', 'anthropic'],                       min: 100, max: 400  },
  { match: ['midjourney'],                                min: 80,  max: 600  },
  { match: ['jasper'],                                    min: 80,  max: 1000 },
  // VPN / security
  { match: ['nordvpn'],                                   min: 20,  max: 200  },
  { match: ['expressvpn'],                                min: 30,  max: 200  },
  { match: ['surfshark'],                                 min: 15,  max: 150  },
  { match: ['mullvad'],                                   min: 40,  max: 80   },
  { match: ['protonvpn', 'proton vpn', 'proton mail'],    min: 30,  max: 300  },
  { match: ['cyberghost'],                                min: 20,  max: 150  },
  { match: ['privateinternetaccess', 'pia vpn'],          min: 20,  max: 150  },
  // Password managers
  { match: ['1password'],                                 min: 20,  max: 300  },
  { match: ['lastpass'],                                  min: 20,  max: 300  },
  { match: ['bitwarden'],                                 min: 10,  max: 100  },
  { match: ['dashlane'],                                  min: 30,  max: 300  },
  { match: ['keeper'],                                    min: 20,  max: 200  },
  // Social / community
  { match: ['linkedin'],                                  min: 80,  max: 1000 },
  { match: ['patreon'],                                   min: 10,  max: 9999 },
  { match: ['onlyfans'],                                  min: 10,  max: 9999 },
  { match: ['twitch'],                                    min: 40,  max: 200  },
  { match: ['discord nitro', 'discord'],                  min: 20,  max: 200  },
  // Gaming
  { match: ['playstation', 'ps plus', 'psn', 'playstation network'], min: 40, max: 300 },
  { match: ['xbox', 'game pass', 'xbox game pass'],       min: 40,  max: 300  },
  { match: ['nintendo'],                                  min: 30,  max: 150  },
  { match: ['ea play', 'ea sports', 'origin'],            min: 30,  max: 200  },
  { match: ['ubisoft'],                                   min: 50,  max: 200  },
  { match: ['steam'],                                     min: 10,  max: 200  },
  { match: ['geforce now', 'nvidia'],                     min: 50,  max: 200  },
  // Health / fitness
  { match: ['headspace'],                                 min: 40,  max: 200  },
  { match: ['calm'],                                      min: 40,  max: 200  },
  { match: ['strava'],                                    min: 40,  max: 150  },
  { match: ['myfitnesspal'],                              min: 40,  max: 200  },
  { match: ['noom'],                                      min: 100, max: 500  },
  { match: ['peloton'],                                   min: 100, max: 400  },
  // Language / learning
  { match: ['duolingo'],                                  min: 50,  max: 200  },
  { match: ['babbel'],                                    min: 50,  max: 200  },
  { match: ['rosetta stone'],                             min: 50,  max: 400  },
  { match: ['skillshare'],                                min: 80,  max: 300  },
  { match: ['masterclass'],                               min: 80,  max: 300  },
  { match: ['coursera'],                                  min: 80,  max: 600  },
  { match: ['udemy'],                                     min: 30,  max: 400  },
  { match: ['brilliant'],                                 min: 80,  max: 200  },
  // News / media
  { match: ['new york times', 'nytimes'],                 min: 50,  max: 300  },
  { match: ['washington post'],                           min: 50,  max: 300  },
  { match: ['the guardian'],                              min: 30,  max: 200  },
  { match: ['dagens nyheter', 'dn.se'],                   min: 50,  max: 300  },
  { match: ['svenska dagbladet', 'svd'],                  min: 50,  max: 300  },
  { match: ['aftonbladet'],                               min: 30,  max: 200  },
  // Printing
  { match: ['hp instant ink', 'hp ink', 'hpinstantink'],  min: 20,  max: 300  },
  // E-commerce / shopping membership
  { match: ['amazon prime', 'amazon'],                    min: 30,  max: 300  },
  // Marketing / business
  { match: ['mailchimp'],                                 min: 50,  max: 9999 },
  { match: ['hubspot'],                                   min: 50,  max: 9999 },
  { match: ['shopify'],                                   min: 100, max: 9999 },
  { match: ['squarespace'],                               min: 80,  max: 600  },
  { match: ['wix'],                                       min: 50,  max: 500  },
  { match: ['godaddy'],                                   min: 30,  max: 600  },
  { match: ['namecheap'],                                 min: 10,  max: 400  },
  { match: ['semrush'],                                   min: 800, max: 9999 },
  { match: ['ahrefs'],                                    min: 800, max: 9999 },
]

function matchKnownService(merchant: string, amount: number): boolean {
  const lower = merchant.toLowerCase()
  for (const svc of KNOWN_SERVICES) {
    if (svc.match.some(m => lower.includes(m))) {
      // Price in reasonable range for this service
      return amount >= svc.min && (svc.max === 0 || amount <= svc.max)
    }
  }
  return false
}

// Retail/store keywords in merchant names that indicate one-time purchases
const RETAIL_KEYWORDS = [
  'utförsäljning', 'outlet', 'systembolaget', 'bokhandel', 'butiken',
  'store', 'shop', 'market', 'supermarket', 'affären', 'rea',
]

function looksLikeRetailStore(name: string): boolean {
  const lower = name.toLowerCase()
  return RETAIL_KEYWORDS.some(kw => lower.includes(kw))
}

function looksLikePersonName(name: string): boolean {
  // "Nicklas Karlson", "Karlsson, Catherine", "John A. Smith"
  return /^[A-ZÅÄÖ][a-zåäö]{1,15}[\s,]+[A-ZÅÄÖ][a-zåäö]{1,20}/.test(name.trim())
}

function senderToMerchant(from: string): string {
  const nameMatch = from.match(/^"?([^"<@\n]+)"?\s*</)?.[1]?.trim()
  if (nameMatch && nameMatch.length > 1) return nameMatch

  const emailMatch = (from.match(/<([^>]+)>/) ?? from.match(/([^\s]+@[^\s]+)/))?.[1] ?? ''
  const domain = (emailMatch.split('@')[1] ?? from)
    .replace(/^(mail\.|email\.|noreply\.|no-reply\.|billing\.|payments?\.|notification\.|info\.|hello\.|support\.|hjalp\.|kundservice\.)/i, '')
    .replace(/\.(com|net|org|io|se|co\.uk|app|nu)$/i, '')
    .replace(/-/g, ' ')
  return domain.charAt(0).toUpperCase() + domain.slice(1)
}

function decodeBase64(str: string): string {
  try {
    return atob(str.replace(/-/g, '+').replace(/_/g, '/'))
  } catch { return '' }
}

function extractText(part: any): string {
  if (!part) return ''
  if ((part.mimeType === 'text/plain' || part.mimeType === 'text/html') && part.body?.data) {
    let text = decodeBase64(part.body.data)
    if (part.mimeType === 'text/html') text = text.replace(/<[^>]+>/g, ' ')
    return text
  }
  if (part.parts) return part.parts.map((p: any) => extractText(p)).join(' ')
  return ''
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const CLIENT_ID = Deno.env.get('GMAIL_CLIENT_ID')
    const CLIENT_SECRET = Deno.env.get('GMAIL_CLIENT_SECRET')
    if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET not set')

    const { action, code, access_token: existingToken } = await req.json()

    if (action === 'exchange') {
      if (!code) throw new Error('code required')
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri: REDIRECT_URI,
          grant_type: 'authorization_code',
        }),
      })
      const tokenData = await tokenRes.json()
      if (!tokenData.access_token) throw new Error(tokenData.error_description || JSON.stringify(tokenData))
      return new Response(JSON.stringify({ access_token: tokenData.access_token }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'scan') {
      if (!existingToken) throw new Error('access_token required')
      const bearer = `Bearer ${existingToken}`
      const query = buildGmailQuery()

      // Search messages — up to 500
      const messageIds: string[] = []
      let pageToken: string | undefined
      for (let page = 0; page < 5; page++) {
        const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=100` +
          (pageToken ? `&pageToken=${pageToken}` : '')
        const res = await fetch(url, { headers: { Authorization: bearer } })
        const data = await res.json()
        if (data.error) throw new Error(data.error.message)
        if (Array.isArray(data.messages)) messageIds.push(...data.messages.map((m: any) => m.id))
        if (!data.nextPageToken || messageIds.length >= 500) break
        pageToken = data.nextPageToken
      }

      // key → { merchant, amount, currency, date, subject, count }
      const seen = new Map<string, any>()

      // Fetch details in batches of 20
      for (let i = 0; i < Math.min(messageIds.length, 300); i += 20) {
        await Promise.all(messageIds.slice(i, i + 20).map(async (id) => {
          try {
            const res = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
              { headers: { Authorization: bearer } }
            )
            const msg = await res.json()
            if (msg.error) return

            const hdrs = msg.payload?.headers ?? []
            const from = hdrs.find((h: any) => h.name === 'From')?.value ?? ''
            const subject = hdrs.find((h: any) => h.name === 'Subject')?.value ?? ''
            const dateStr = hdrs.find((h: any) => h.name === 'Date')?.value ?? ''
            const date = dateStr ? new Date(dateStr).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]

            const merchant = senderToMerchant(from)
            if (!merchant || merchant.length < 2) return
            if (looksLikePersonName(merchant)) return
            if (looksLikeRetailStore(merchant)) return

            const bodyText = extractText(msg.payload).slice(0, 3000)
            const searchText = `${subject} ${bodyText}`

            const amount = extractAmount(searchText)
            if (!amount || amount < 9 || amount > 30000) return

            const currency = extractCurrency(searchText)
            const isKnown = matchKnownService(merchant, amount)

            // Known services: just need a valid amount. Unknown: must look like a subscription email.
            if (!isKnown && !isSubscriptionEmail(searchText)) return

            const key = merchant.toLowerCase()
            const existing = seen.get(key)
            if (!existing) {
              seen.set(key, { merchant, amount, currency, date, subject: subject.slice(0, 80), count: 1, isKnown })
            } else {
              existing.count++
              if (date > existing.date) {
                existing.amount = amount
                existing.currency = currency
                existing.date = date
                existing.subject = subject.slice(0, 80)
              }
            }
          } catch { /* skip individual message errors */ }
        }))
      }

      // Known services: 1 email is enough. Unknown senders: require 2+ (filters promos).
      const subscriptions: any[] = []
      seen.forEach(s => {
        if (s.isKnown || s.count >= 2) subscriptions.push(s)
      })

      return new Response(JSON.stringify({
        subscriptions,
        debug: { messages_found: messageIds.length, unique_merchants: seen.size },
      }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
    }

    throw new Error('Invalid action')
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
