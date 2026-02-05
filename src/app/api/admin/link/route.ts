import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, adminSupabase } from '@/lib/supabase-server';

const ADMIN_EMAILS = ['setharterburn@gmail.com', 'seth@arterburn.me'];

const PUSHOVER_USER = process.env.PUSHOVER_USER_KEY;
const PUSHOVER_TOKEN = process.env.PUSHOVER_APP_TOKEN;

async function sendPushover(title: string, message: string) {
  if (!PUSHOVER_USER || !PUSHOVER_TOKEN) return;
  
  try {
    await fetch('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: PUSHOVER_TOKEN,
        user: PUSHOVER_USER,
        title,
        message,
        priority: -1,
      }),
    });
  } catch (err) {
    console.error('Pushover failed:', err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user || !ADMIN_EMAILS.includes(user.email || '')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { userId, iptvUsername, iptvPassword } = await req.json();

    if (!userId || !iptvUsername) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Fetch real expiry from IPTV panel
    let expiresAt = null;
    try {
      const AUTOMATION_URL = process.env.AUTOMATION_URL || 'http://149.56.97.159:3007';
      const lookupRes = await fetch(`${AUTOMATION_URL}/api/lookup/${encodeURIComponent(iptvUsername)}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (lookupRes.ok) {
        const panelData = await lookupRes.json();
        if (panelData.expireTimestamp) {
          expiresAt = new Date(panelData.expireTimestamp * 1000).toISOString();
        }
      }
    } catch (err) {
      console.error('Panel lookup failed:', err);
    }

    // Check if subscription already exists
    const { data: existing } = await adminSupabase
      .from('user_subscriptions')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (existing) {
      // Update existing
      await adminSupabase
        .from('user_subscriptions')
        .update({
          iptv_username: iptvUsername,
          iptv_password: iptvPassword || null,
          status: 'active',
          expires_at: expiresAt || undefined,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    } else {
      // Create new
      await adminSupabase
        .from('user_subscriptions')
        .insert({
          user_id: userId,
          iptv_username: iptvUsername,
          iptv_password: iptvPassword || null,
          status: 'active',
          expires_at: expiresAt,
          plan_name: '1 Month',
          price_cents: 2500,
        });
    }

    // Mark any pending matches as resolved
    await adminSupabase
      .from('pending_matches')
      .update({ status: 'linked', reviewed_at: new Date().toISOString() })
      .eq('user_id', userId);

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error('Admin link error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
