import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const REDIRECT_URI = 'https://trimcost.app/app'

// Keywords that suggest subscription-related emails
const SUB_KEYWORDS = [
  'receipt', 'invoice', 'subscription', 'billing', 'payment confirmation',
  'renewal', 'renewed', 'charged', 'prenumeration', 'faktura', 'kvitto',
  'your plan', 'din prenumeration', 'monthly', 'annual', 'yearly',
  'order confirmation', 'purchase confirmation',
]

function buildGmailQuery(): string {
  const keywordQuery = SUB_KEYWORDS.slice(0, 10).map(k => `"${k}"`).join(' OR ')
  return `(${keywordQuery}) newer_than:24m`
}

function extractAmount(text: string): number | null {
  // Match common currency patterns
  const patterns = [
    /(\d+[\.,]\d{2})\s*(?:SEK|kr|USD|\$|EUR|€|GBP|£)/i,
    /(?:SEK|kr|USD|\$|EUR|€|GBP|£)\s*(\d+[\.,]\d{2})/i,
    /(?:total|amount|charged|billed|price|sum)[\s:]*(?:[A-Z]{3}\s*)?(\d+[\.,]\d{2})/i,
    /(\d+[\.,]\d{2})\s*(?:per month|\/month|\/mo|per year|\/year)/i,
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

function senderToMerchant(from: string): string {
  // Extract display name or domain
  const nameMatch = from.match(/^"?([^"<]+)"?\s*</)?.[1]?.trim()
  if (nameMatch && nameMatch.length > 2 && !nameMatch.includes('@')) return nameMatch

  const emailMatch = from.match(/<([^>]+)>/) ?? from.match(/([^\s]+@[^\s]+)/)
  if (emailMatch) {
    const email = emailMatch[1]
    const domain = email.split('@')[1] ?? ''
    // Strip common prefixes
    const cleaned = domain
      .replace(/^(mail\.|email\.|noreply\.|no-reply\.|billing\.|payments?\.|notification\.|info\.|hello\.|support\.)/i, '')
      .replace(/\.(com|net|org|io|se|co\.uk|app)$/i, '')
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
  }
  return from
}

function decodeBase64(str: string): string {
  try {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/')
    return atob(b64)
  } catch { return '' }
}

function extractTextFromPart(part: any): string {
  if (!part) return ''
  if (part.mimeType === 'text/plain' && part.body?.data) {
    return decodeBase64(part.body.data)
  }
  if (part.mimeType === 'text/html' && part.body?.data) {
    return decodeBase64(part.body.data).replace(/<[^>]+>/g, ' ')
  }
  if (part.parts) {
    return part.parts.map((p: any) => extractTextFromPart(p)).join(' ')
  }
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
      // Exchange authorization code for tokens
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
      const token = existingToken
      if (!token) throw new Error('access_token required')

      const bearer = `Bearer ${token}`
      const query = buildGmailQuery()

      // Search messages
      let messageIds: string[] = []
      let pageToken: string | undefined
      for (let page = 0; page < 5; page++) {
        const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=100` +
          (pageToken ? `&pageToken=${pageToken}` : '')
        const searchRes = await fetch(url, { headers: { Authorization: bearer } })
        const searchData = await searchRes.json()
        if (searchData.error) throw new Error(searchData.error.message)
        if (Array.isArray(searchData.messages)) messageIds.push(...searchData.messages.map((m: any) => m.id))
        if (!searchData.nextPageToken || messageIds.length >= 300) break
        pageToken = searchData.nextPageToken
      }

      // Fetch message details in batches of 20
      const subscriptions: any[] = []
      const seen = new Map<string, any>() // merchant -> sub

      for (let i = 0; i < Math.min(messageIds.length, 200); i += 20) {
        const batch = messageIds.slice(i, i + 20)
        await Promise.all(batch.map(async (id) => {
          const msgRes = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
            { headers: { Authorization: bearer } }
          )
          const msg = await msgRes.json()
          if (msg.error) return

          const headers = msg.payload?.headers ?? []
          const from = headers.find((h: any) => h.name === 'From')?.value ?? ''
          const subject = headers.find((h: any) => h.name === 'Subject')?.value ?? ''
          const dateStr = headers.find((h: any) => h.name === 'Date')?.value ?? ''
          const date = dateStr ? new Date(dateStr).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]

          const bodyText = extractTextFromPart(msg.payload)
          const searchText = `${subject} ${bodyText}`.slice(0, 2000)

          const amount = extractAmount(searchText)
          if (!amount || amount < 0.5 || amount > 50000) return

          const currency = extractCurrency(searchText)
          const merchant = senderToMerchant(from)
          const key = merchant.toLowerCase()

          // Keep most recent email per merchant
          if (!seen.has(key) || date > seen.get(key).date) {
            seen.set(key, { merchant, amount, currency, date, subject })
          }
        }))
      }

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
