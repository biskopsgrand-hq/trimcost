import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const { redirect_uri, user_id, market = 'SE' } = await req.json()
    const CLIENT_ID     = Deno.env.get('TINK_CLIENT_ID')
    const CLIENT_SECRET = Deno.env.get('TINK_CLIENT_SECRET')
    const TEST_MODE     = Deno.env.get('TINK_TEST_MODE') !== 'false' // default true for sandbox

    if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('TINK_CLIENT_ID or TINK_CLIENT_SECRET not set')
    if (!redirect_uri) throw new Error('redirect_uri required')

    // 1. Get client access token with authorization:grant scope
    const basicAuth = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)
    const tokenRes = await fetch('https://api.tink.com/api/v1/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'authorization:grant',
      }).toString(),
    })
    const tokenData = await tokenRes.json()
    if (!tokenData.access_token) {
      throw new Error(tokenData.error_description || JSON.stringify(tokenData))
    }

    // 2. Create user authorization grant
    const grantRes = await fetch('https://api.tink.com/api/v1/oauth/authorization-grant', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: user_id || `tc-${Date.now()}`,
        scope: 'transactions:read,accounts:read,credentials:read',
      }),
    })
    const grantData = await grantRes.json()
    if (!grantData.code) {
      throw new Error(grantData.error_description || JSON.stringify(grantData))
    }

    // 3. Build Tink Link URL
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri,
      authorization_code: grantData.code,
      market,
      locale: 'en_US',
    })
    if (TEST_MODE) params.set('test', 'true')
    const url = `https://link.tink.com/1.0/transactions/connect-accounts?${params}`

    return new Response(JSON.stringify({ url }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
