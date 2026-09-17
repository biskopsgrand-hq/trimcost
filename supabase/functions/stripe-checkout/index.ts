import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const PRICE_ID = 'price_1UGmSuJ0MUG8zNuPUANCz41f'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')
    if (!SECRET_KEY) throw new Error('STRIPE_SECRET_KEY not set')

    const { user_email, user_id } = await req.json()
    if (!user_id) throw new Error('user_id required')

    const params = new URLSearchParams({
      mode: 'subscription',
      'line_items[0][price]': PRICE_ID,
      'line_items[0][quantity]': '1',
      success_url: 'https://trimcost.app/app?stripe_success=1',
      cancel_url: 'https://trimcost.app/app',
      client_reference_id: user_id,
      allow_promotion_codes: 'true',
      'subscription_data[trial_period_days]': '7',
    })
    if (user_email) params.set('customer_email', user_email)

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })

    const data = await res.json()
    if (!res.ok) throw new Error(data.error?.message || JSON.stringify(data))

    return new Response(JSON.stringify({ url: data.url }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
