import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Verify Stripe webhook signature using Web Crypto API
async function verifyStripeSignature(body: string, sigHeader: string, secret: string): Promise<boolean> {
  const parts = sigHeader.split(',').reduce((acc: Record<string, string>, part) => {
    const [k, v] = part.split('=')
    acc[k] = v
    return acc
  }, {})
  const timestamp = parts['t']
  const sig = parts['v1']
  if (!timestamp || !sig) return false

  const payload = `${timestamp}.${body}`
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  const expected = Array.from(new Uint8Array(signed)).map(b => b.toString(16).padStart(2, '0')).join('')
  return expected === sig
}

serve(async (req) => {
  const SECRET_KEY    = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
  const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? ''
  const signature     = req.headers.get('stripe-signature') ?? ''
  const body          = await req.text()

  const valid = await verifyStripeSignature(body, signature, WEBHOOK_SECRET)
  if (!valid) return new Response('Webhook signature invalid', { status: 400 })

  const event = JSON.parse(body)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object
    const userId = session.client_reference_id
    if (userId) {
      await supabase.from('profiles').upsert({
        user_id: userId,
        is_pro: true,
        stripe_customer_id: session.customer,
      }, { onConflict: 'user_id' })
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object
    await supabase.from('profiles').update({ is_pro: false }).eq('stripe_customer_id', sub.customer)
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
