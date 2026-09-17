import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { email, name, renewal_date } = await req.json()
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')

    if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not set')

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Subscription cancelled</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 16px">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7">

        <!-- Header -->
        <tr><td style="background:#052e16;padding:28px 32px;text-align:center">
          <span style="font-size:22px;font-weight:700;color:#4ade80;letter-spacing:-0.5px">TrimCost</span>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:32px">
          <p style="margin:0 0 8px;font-size:18px;font-weight:600;color:#111827">
            Sorry to see you go 👋
          </p>
          <p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.6">
            Hi ${name || 'there'}, we hope TrimCost was beneficial for you — see ya! Your Pro subscription has been cancelled. Here's what happens next:
          </p>

          <!-- Info box -->
          <table width="100%" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;margin-bottom:24px">
            <tr><td style="padding:16px 18px">
              <p style="margin:0 0 10px;font-size:13px;color:#166534;display:flex;align-items:center;gap:8px">
                ✅ &nbsp;You keep full Pro access until <strong>${renewal_date}</strong>
              </p>
              <p style="margin:0 0 10px;font-size:13px;color:#166534">
                ✅ &nbsp;No further charges will be made
              </p>
              <p style="margin:0;font-size:13px;color:#166534">
                ✅ &nbsp;Your subscription won't renew automatically
              </p>
            </td></tr>
          </table>

          <p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.6">
            After ${renewal_date}, your account will revert to the free plan. You can resubscribe at any time from the app.
          </p>

          <table width="100%"><tr><td align="center">
            <a href="https://trimcost.app/app" style="display:inline-block;background:#16a34a;color:#fff;font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;text-decoration:none">
              Open TrimCost
            </a>
          </td></tr></table>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:20px 32px;border-top:1px solid #f0f0f0;text-align:center">
          <p style="margin:0;font-size:12px;color:#9ca3af">
            TrimCost · <a href="https://trimcost.app" style="color:#9ca3af">trimcost.app</a>
          </p>
          <p style="margin:6px 0 0;font-size:11px;color:#d1d5db">
            You're receiving this because you cancelled your TrimCost Pro subscription.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'TrimCost <noreply@trimcost.app>',
        to: [email],
        subject: `Your TrimCost Pro subscription has been cancelled`,
        html,
      }),
    })

    const data = await res.json()
    return new Response(JSON.stringify(data), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
      status: res.ok ? 200 : 400,
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
