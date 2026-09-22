import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ADMIN_EMAIL = 'biskopsgrand@gmail.com'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS })

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SERVICE_ROLE_KEY')!,
    )

    // Verify caller is the admin
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token)
    if (userErr || !user || user.email !== ADMIN_EMAIL) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: CORS })
    }

    // Total users
    const { data: { users } } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 })
    const totalUsers = users?.length ?? 0

    // Signups last 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const recentSignups = users?.filter(u => u.created_at > sevenDaysAgo).length ?? 0

    // Pro users
    const { count: proUsers } = await supabaseAdmin
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('is_pro', true)

    // Users who connected a bank (have subscriptions)
    const { data: subRows } = await supabaseAdmin
      .from('subscriptions')
      .select('user_id')
    const connectedUsers = new Set(subRows?.map((r: any) => r.user_id)).size

    // Total subscriptions detected across all users
    const { count: totalSubs } = await supabaseAdmin
      .from('subscriptions')
      .select('*', { count: 'exact', head: true })

    return new Response(JSON.stringify({
      totalUsers,
      recentSignups,
      proUsers: proUsers ?? 0,
      connectedUsers,
      totalSubs: totalSubs ?? 0,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } })

  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: CORS })
  }
})
