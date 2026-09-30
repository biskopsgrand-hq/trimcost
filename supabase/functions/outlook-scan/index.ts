import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const REDIRECT_URI = 'https://trimcost.app/app'
const GRAPH = 'https://graph.microsoft.com/v1.0'

const SUB_KEYWORDS = [
  'receipt', 'invoice', 'subscription', 'billing', 'payment confirmation',
  'renewal', 'renewed', 'charged', 'prenumeration', 'faktura', 'kvitto',
  'your plan', 'monthly', 'annual', 'yearly', 'order confirmation',
]

function extractAmount(text: string): number | null {
  const patterns = [
    /(\d+[\.,]\d{2})\s*(?:SEK|kr|USD|\$|EUR|€|GBP|£)/i,
    /(?:SEK|kr|USD|\$|EUR|€|GBP|£)\s*(\d+[\.,]\d{2})/i,
    /(?:total|amount|charged|billed|price|sum)[\s:]*(?:[A-Z]{3}\s*)?(\d+[\.,]\d{2})/i,
  ]
  for (const p of patterns) {
    const m = text.match(p)
    if (m) return parseFloat(m[1].replace(',', '.'))
  }
  return null
}

function extractCurrency(text: string): string {
  if (/SEK|kr\b/i.test(text)) return 'SEK'
  if (/USD|\$/i.test(text)) return 'USD'
  if (/EUR|€/i.test(text)) return 'EUR'
  if (/GBP|£/i.test(text)) return 'GBP'
  return 'USD'
}

function senderToMerchant(from: string, emailAddress: string): string {
  if (from && from.length > 2 && !from.includes('@')) return from
  const domain = (emailAddress.split('@')[1] ?? '')
    .replace(/^(mail\.|email\.|noreply\.|no-reply\.|billing\.|payments?\.|notification\.|info\.|hello\.|support\.)/i, '')
    .replace(/\.(com|net|org|io|se|co\.uk|app)$/i, '')
  return domain.charAt(0).toUpperCase() + domain.slice(1)
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const CLIENT_ID = Deno.env.get('OUTLOOK_CLIENT_ID')
    const CLIENT_SECRET = Deno.env.get('OUTLOOK_CLIENT_SECRET')
    if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('OUTLOOK_CLIENT_ID or OUTLOOK_CLIENT_SECRET not set')

    const { action, code, access_token: existingToken } = await req.json()

    if (action === 'exchange') {
      if (!code) throw new Error('code required')
      const tokenRes = await fetch(`https://login.microsoftonline.com/common/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri: REDIRECT_URI,
          grant_type: 'authorization_code',
          scope: 'https://graph.microsoft.com/Mail.Read',
        }),
      })
      const tokenData = await tokenRes.json()
      if (!tokenData.access_token) throw new Error(tokenData.error_description || JSON.stringify(tokenData))
      return new Response(JSON.stringify({ access_token: tokenData.access_token }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'scan') {
      const token = existingToken
      if (!token) throw new Error('access_token required')

      const bearer = `Bearer ${token}`
      const twoYearsAgo = new Date()
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2)
      const since = twoYearsAgo.toISOString()

      // Build search filter using subject keywords
      const keywordFilter = SUB_KEYWORDS.slice(0, 8)
        .map(k => `contains(subject,'${k}')`)
        .join(' or ')
      const filter = `receivedDateTime ge ${since} and (${keywordFilter})`

      const messages: any[] = []
      let nextLink: string | null =
        `${GRAPH}/me/messages?$filter=${encodeURIComponent(filter)}&$top=100&$select=subject,from,receivedDateTime,body&$orderby=receivedDateTime desc`

      for (let page = 0; page < 5 && nextLink; page++) {
        const res = await fetch(nextLink, { headers: { Authorization: bearer } })
        const data = await res.json()
        if (data.error) throw new Error(data.error.message)
        if (Array.isArray(data.value)) messages.push(...data.value)
        nextLink = data['@odata.nextLink'] ?? null
        if (messages.length >= 300) break
      }

      const seen = new Map<string, any>()

      for (const msg of messages.slice(0, 200)) {
        const from = msg.from?.emailAddress?.name ?? ''
        const emailAddr = msg.from?.emailAddress?.address ?? ''
        const subject = msg.subject ?? ''
        const date = msg.receivedDateTime?.split('T')[0] ?? ''
        const bodyText = stripHtml(msg.body?.content ?? '').slice(0, 2000)
        const searchText = `${subject} ${bodyText}`

        const amount = extractAmount(searchText)
        if (!amount || amount < 0.5 || amount > 50000) continue

        const currency = extractCurrency(searchText)
        const merchant = senderToMerchant(from, emailAddr)
        const key = merchant.toLowerCase()

        if (!seen.has(key) || date > seen.get(key).date) {
          seen.set(key, { merchant, amount, currency, date, subject })
        }
      }

      const subscriptions: any[] = []
      seen.forEach(sub => subscriptions.push(sub))

      return new Response(JSON.stringify({ subscriptions }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    throw new Error('Invalid action')
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
