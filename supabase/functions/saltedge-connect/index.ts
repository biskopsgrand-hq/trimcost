import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BASE = 'https://www.saltedge.com/api/v6'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const APP_ID = Deno.env.get('SALTEDGE_APP_ID')
    const SECRET = Deno.env.get('SALTEDGE_SECRET')
    if (!APP_ID || !SECRET) throw new Error('SALTEDGE_APP_ID or SALTEDGE_SECRET not set')

    const { user_id } = await req.json()
    if (!user_id) throw new Error('user_id required')

    const hdrs = { 'App-id': APP_ID, 'Secret': SECRET, 'Content-Type': 'application/json' }

    // Try to fetch existing customer first, create if not found
    let customer_id: string
    const listRes = await fetch(`${BASE}/customers?identifier=${encodeURIComponent(user_id)}`, { headers: hdrs })
    const listData = await listRes.json()

    if (listRes.ok && listData.data?.length > 0) {
      customer_id = listData.data[0].id
    } else {
      const custRes = await fetch(`${BASE}/customers`, {
        method: 'POST',
        headers: hdrs,
        body: JSON.stringify({ data: { identifier: user_id } }),
      })
      const custData = await custRes.json()
      if (!custRes.ok) throw new Error(custData.error?.message || JSON.stringify(custData))
      customer_id = custData.data.id
    }

    // Request 2 years of history
    const fromDate = new Date()
    fromDate.setFullYear(fromDate.getFullYear() - 2)

    // v6 uses /connections/connect instead of /connect_sessions/create
    const sessionRes = await fetch(`${BASE}/connections/connect`, {
      method: 'POST',
      headers: hdrs,
      body: JSON.stringify({
        data: {
          customer_id,
          consent: {
            scopes: ['accounts', 'transactions'],
            from_date: fromDate.toISOString().split('T')[0],
          },
          attempt: {
            return_to: 'https://trimcost.app/app',
          },
        },
      }),
    })
    const sessionData = await sessionRes.json()
    if (!sessionRes.ok) throw new Error(sessionData.error?.message || JSON.stringify(sessionData))

    return new Response(JSON.stringify({
      connect_url: sessionData.data.connect_url,
      customer_id,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
