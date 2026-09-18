import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { email } = await req.json()
    if (!email) return new Response(JSON.stringify({ error: 'Email required' }), { status: 400, headers: CORS })

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo: 'https://trimcost.app/app' },
    })

    if (error || !data?.properties?.action_link) {
      return new Response(JSON.stringify({ error: error?.message || 'Could not generate reset link' }), { status: 400, headers: CORS })
    }

    const resetUrl = data.properties.action_link

    const html = `
<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#052e16;border-radius:16px">
  <div style="margin-bottom:24px">
    <svg width="28" height="28" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="7" cy="7" r="4.5" stroke="#4ade80" stroke-width="1.5"/>
      <circle cx="7" cy="23" r="4.5" stroke="#4ade80" stroke-width="1.5"/>
      <line x1="11" y1="9" x2="26" y2="24" stroke="#4ade80" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="11" y1="21" x2="26" y2="6" stroke="#4ade80" stroke-width="1.8" stroke-linecap="round"/>
    </svg>
    <span style="font-size:18px;font-weight:700;color:#4ade80;vertical-align:middle;margin-left:8px">TrimCost</span>
  </div>
  <h1 style="font-size:22px;font-weight:700;color:#ffffff;margin:0 0 10px">Reset your password</h1>
  <p style="font-size:15px;color:#86efac;line-height:1.6;margin:0 0 28px">We received a request to reset your password. Click the button below — the link expires in 1 hour.</p>
  <a href="${resetUrl}" style="display:inline-block;background:#4ade80;color:#052e16;font-weight:700;font-size:15px;padding:14px 28px;border-radius:10px;text-decoration:none">Reset my password →</a>
  <p style="font-size:12px;color:#4ade8088;margin-top:32px">If you didn't request a password reset, you can safely ignore this email. Your password won't change.</p>
</div>`

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'TrimCost <hello@trimcost.app>',
        to: [email],
        subject: 'Reset your TrimCost password',
        html,
      }),
    })

    if (!resendRes.ok) {
      const err = await resendRes.text()
      return new Response(JSON.stringify({ error: err }), { status: 500, headers: CORS })
    }

    return new Response(JSON.stringify({ ok: true }), { headers: CORS })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: CORS })
  }
})
