import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { email } = await req.json()
    if (!email) return new Response(JSON.stringify({ error: 'Email required' }), { status: 400, headers: CORS })

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY')!

    console.log('SUPABASE_URL present:', !!supabaseUrl)
    console.log('SERVICE_ROLE_KEY length:', serviceRoleKey?.length ?? 0)
    console.log('SERVICE_ROLE_KEY starts with:', serviceRoleKey?.substring(0, 10))

    // Generate recovery link via Supabase Admin REST API (no SDK)
    const linkRes = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'recovery',
        email,
        redirect_to: 'https://trimcost.app/app',
      }),
    })

    if (!linkRes.ok) {
      const err = await linkRes.text()
      console.error('generateLink failed:', linkRes.status, err)
      return new Response(JSON.stringify({ error: err }), { status: 400, headers: CORS })
    }

    const linkData = await linkRes.json()
    const resetUrl = linkData.action_link
    console.log('Got action_link:', !!resetUrl)

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

    const resendKey = Deno.env.get('RESEND_API_KEY') ?? ''
    console.log('RESEND_API_KEY length:', resendKey.length)
    console.log('RESEND_API_KEY starts with:', resendKey.substring(0, 5))

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
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
      console.error('Resend failed:', err)
      return new Response(JSON.stringify({ error: err }), { status: 500, headers: CORS })
    }

    console.log('Email sent successfully')
    return new Response(JSON.stringify({ ok: true }), { headers: CORS })
  } catch (e) {
    console.error('Uncaught error:', e)
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: CORS })
  }
})
