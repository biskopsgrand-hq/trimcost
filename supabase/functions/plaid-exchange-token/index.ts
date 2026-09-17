import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function dateStr(d: Date) {
  return d.toISOString().split('T')[0]
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const { public_token } = await req.json()
    const PLAID_CLIENT_ID = Deno.env.get('PLAID_CLIENT_ID')
    const PLAID_SECRET    = Deno.env.get('PLAID_SECRET')
    const PLAID_ENV       = Deno.env.get('PLAID_ENV') || 'sandbox'

    if (!PLAID_CLIENT_ID || !PLAID_SECRET) throw new Error('PLAID_CLIENT_ID or PLAID_SECRET not set')

    // Exchange public token for access token
    const exchangeRes = await fetch(`https://${PLAID_ENV}.plaid.com/item/public_token/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: PLAID_CLIENT_ID, secret: PLAID_SECRET, public_token }),
    })
    const exchangeData = await exchangeRes.json()
    const access_token = exchangeData.access_token
    if (!access_token) throw new Error(exchangeData.error_message || 'Token exchange failed')

    // Fetch accounts
    const accountsRes = await fetch(`https://${PLAID_ENV}.plaid.com/accounts/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: PLAID_CLIENT_ID, secret: PLAID_SECRET, access_token }),
    })
    const { accounts } = await accountsRes.json()

    // Fetch transactions — last 365 days for better recurring detection
    const endDate   = dateStr(new Date())
    const startDate = dateStr(new Date(Date.now() - 365 * 86400000))
    const txRes = await fetch(`https://${PLAID_ENV}.plaid.com/transactions/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: PLAID_CLIENT_ID,
        secret: PLAID_SECRET,
        access_token,
        start_date: startDate,
        end_date: endDate,
        options: { count: 500, offset: 0 },
      }),
    })
    const { transactions } = await txRes.json()

    return new Response(JSON.stringify({ accounts, transactions: transactions || [] }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
