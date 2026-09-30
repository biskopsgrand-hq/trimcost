import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BASE = 'https://www.saltedge.com/api/v5'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const APP_ID = Deno.env.get('SALTEDGE_APP_ID')
    const SECRET = Deno.env.get('SALTEDGE_SECRET')
    if (!APP_ID || !SECRET) throw new Error('SALTEDGE_APP_ID or SALTEDGE_SECRET not set')

    const { connection_id } = await req.json()
    if (!connection_id) throw new Error('connection_id required')

    const hdrs = { 'App-id': APP_ID, 'Secret': SECRET }

    // Fetch accounts
    const acctRes = await fetch(`${BASE}/accounts?connection_id=${connection_id}`, { headers: hdrs })
    const acctData = await acctRes.json()
    if (!acctRes.ok) throw new Error(acctData.error?.message || JSON.stringify(acctData))

    // Fetch transactions — paginate up to 10 pages (10k transactions)
    const txAll: any[] = []
    let nextId: string | null = null
    for (let page = 0; page < 10; page++) {
      let url = `${BASE}/transactions?connection_id=${connection_id}&per_page=1000`
      if (nextId) url += `&from_id=${nextId}`
      const txRes = await fetch(url, { headers: hdrs })
      const txData = await txRes.json()
      if (!txRes.ok) break
      if (Array.isArray(txData.data)) txAll.push(...txData.data)
      if (!txData.meta?.next_id) break
      nextId = txData.meta.next_id
    }

    return new Response(JSON.stringify({
      accounts: acctData.data || [],
      transactions: txAll,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
