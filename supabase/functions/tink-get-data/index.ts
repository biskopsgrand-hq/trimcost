import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const { code } = await req.json()
    const CLIENT_ID     = Deno.env.get('TINK_CLIENT_ID')
    const CLIENT_SECRET = Deno.env.get('TINK_CLIENT_SECRET')

    if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('TINK_CLIENT_ID or TINK_CLIENT_SECRET not set')
    if (!code) throw new Error('code required')

    // Exchange authorization code for user access token
    const tokenRes = await fetch('https://api.tink.com/api/v1/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
      }),
    })
    const tokenData = await tokenRes.json()
    if (!tokenData.access_token) {
      throw new Error(tokenData.error_description || JSON.stringify(tokenData))
    }

    const bearer = `Bearer ${tokenData.access_token}`

    // Fetch accounts
    const acctRes = await fetch('https://api.tink.com/data/v2/accounts', {
      headers: { 'Authorization': bearer },
    })
    const acctData = await acctRes.json()

    // Fetch transactions — paginate up to 5 pages (500 total)
    const txAll: any[] = []
    let pageToken = ''
    for (let page = 0; page < 5; page++) {
      const url = 'https://api.tink.com/data/v2/transactions?pageSize=100' +
                  (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '')
      const txRes = await fetch(url, { headers: { 'Authorization': bearer } })
      const txData = await txRes.json()
      if (Array.isArray(txData.transactions)) txAll.push(...txData.transactions)
      if (!txData.nextPageToken) break
      pageToken = txData.nextPageToken
    }

    return new Response(JSON.stringify({
      accounts: acctData.accounts || [],
      transactions: txAll,
    }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
