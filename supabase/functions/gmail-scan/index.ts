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

            const bodyText = extractText(msg.payload).slice(0, 3000)
            const searchText = `${subject} ${bodyText}`

            if (!isSubscriptionEmail(searchText)) return

            const amount = extractAmount(searchText)
            if (!amount || amount < 9 || amount > 30000) return

            const currency = extractCurrency(searchText)
            const merchant = senderToMerchant(from)
            if (!merchant || merchant.length < 2) return
            if (looksLikePersonName(merchant)) return
            if (looksLikeRetailStore(merchant)) return

            const key = merchant.toLowerCase()
            if (!seen.has(key) || date > seen.get(key).date) {
              seen.set(key, { merchant, amount, currency, date, subject: subject.slice(0, 80) })
            }
          } catch { /* skip individual message errors */ }
        }))
      }

      const subscriptions: any[] = []
      seen.forEach(s => subscriptions.push(s))

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
