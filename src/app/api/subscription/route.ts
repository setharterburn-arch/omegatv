import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase, adminSupabase } from '@/lib/supabase-server'

const AUTOMATION_URL = process.env.AUTOMATION_URL || 'http://149.56.97.159:3007'

async function fetchPanelExpiry(iptvUsername: string): Promise<{ expDate: string | null; expTimestamp: number | null }> {
  try {
    const res = await fetch(`${AUTOMATION_URL}/api/lookup/${encodeURIComponent(iptvUsername)}`, {
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return { expDate: null, expTimestamp: null }
    const data = await res.json()
    return {
      expDate: data.expireDate || null,    // "05-10-2026 13:19"
      expTimestamp: data.expireTimestamp || null,  // Unix timestamp
    }
  } catch {
    return { expDate: null, expTimestamp: null }
  }
}

export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('userId')
    let effectiveUserId = userId
    
    // If no userId provided, get from current session
    if (!effectiveUserId) {
      const supabase = createServerSupabase()
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      effectiveUserId = user.id
    }
    
    // Check for linked subscription
    const { data: subscription, error } = await adminSupabase
      .from('user_subscriptions')
      .select('*')
      .eq('user_id', effectiveUserId)
      .single()
    
    if (error || !subscription) {
      // Check if pending review
      const { data: pending } = await adminSupabase
        .from('pending_matches')
        .select('*')
        .eq('user_id', effectiveUserId)
        .single()
      
      if (pending) {
        return NextResponse.json({
          status: 'pending',
          message: 'Your account is pending setup.',
        })
      }
      
      return NextResponse.json({ 
        status: 'unlinked',
      })
    }
    
    // Fetch real expiry from IPTV panel
    let expiryDate = subscription.expires_at ? new Date(subscription.expires_at) : null
    const panelData = subscription.iptv_username 
      ? await fetchPanelExpiry(subscription.iptv_username)
      : { expDate: null, expTimestamp: null }
    
    // Use panel expiry if available (it's the source of truth)
    if (panelData.expTimestamp) {
      expiryDate = new Date(panelData.expTimestamp * 1000)
      
      // Sync back to database if different
      const dbExpiry = subscription.expires_at ? new Date(subscription.expires_at).getTime() : 0
      if (Math.abs(expiryDate.getTime() - dbExpiry) > 86400000) { // >1 day difference
        await adminSupabase
          .from('user_subscriptions')
          .update({ expires_at: expiryDate.toISOString() })
          .eq('id', subscription.id)
      }
    }

    const now = new Date()
    const daysRemaining = expiryDate 
      ? Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      : null
    
    return NextResponse.json({
      status: daysRemaining === null ? subscription.status : (daysRemaining > 0 ? 'active' : 'expired'),
      username: subscription.iptv_username,
      expiryDate: expiryDate 
        ? expiryDate.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })
        : 'Unknown',
      daysRemaining: daysRemaining !== null ? Math.max(0, daysRemaining) : null,
      planName: subscription.plan_name || 'Omega TV Premium',
      // Full subscription object for renew page
      subscription: {
        id: subscription.id,
        iptv_username: subscription.iptv_username,
        plan_name: subscription.plan_name,
        price_cents: subscription.price_cents,
        status: subscription.status,
        expires_at: expiryDate ? expiryDate.toISOString() : subscription.expires_at,
        auto_renew: subscription.auto_renew,
      }
    })
  } catch (err) {
    console.error('Subscription error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
