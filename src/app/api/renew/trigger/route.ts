import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, adminSupabase } from '@/lib/supabase-server';

const IPTV_PANEL_URL = process.env.IPTV_PANEL_URL!;
const IPTV_PANEL_USER = process.env.IPTV_PANEL_USER!;
const IPTV_PANEL_PASS = process.env.IPTV_PANEL_PASS!;

export async function POST(req: NextRequest) {
  try {
    const supabase = createServerSupabase();
    
    // Verify auth
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { subscriptionId, paymentId, planMonths = 1 } = await req.json();

    if (!subscriptionId) {
      return NextResponse.json({ error: 'Missing subscription ID' }, { status: 400 });
    }

    // Get subscription
    const { data: subscription } = await adminSupabase
      .from('user_subscriptions')
      .select('*')
      .eq('id', subscriptionId)
      .single();

    if (!subscription) {
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
    }

    // Trigger the renewal automation
    const renewResponse = await fetch('http://localhost:3007/api/renew', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        iptvUsername: subscription.iptv_username,
        planMonths,
        panelUrl: IPTV_PANEL_URL,
        panelUser: IPTV_PANEL_USER,
        panelPass: IPTV_PANEL_PASS,
      }),
    });

    if (!renewResponse.ok) {
      const errorData = await renewResponse.json().catch(() => ({}));
      console.error('Renewal automation failed:', errorData);
      
      // Mark payment as needing manual attention
      if (paymentId) {
        await adminSupabase
          .from('payments')
          .update({ status: 'renewal_pending' })
          .eq('id', paymentId);
      }
      
      return NextResponse.json({ 
        error: 'Renewal automation failed - will be processed manually',
        needsManualReview: true,
      }, { status: 500 });
    }

    const renewResult = await renewResponse.json();

    // Update subscription expiry (lifetime = no expiry)
    const isLifetime = planMonths === 0;
    const newExpiry = isLifetime ? null : new Date();
    if (newExpiry) {
      newExpiry.setMonth(newExpiry.getMonth() + planMonths);
    }

    await adminSupabase
      .from('user_subscriptions')
      .update({
        expires_at: isLifetime ? null : newExpiry!.toISOString(),
        status: 'active',
        plan_name: isLifetime ? 'Lifetime Access' : `${planMonths} Month`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', subscriptionId);

    return NextResponse.json({
      success: true,
      message: 'Subscription renewed successfully',
      expiresAt: newExpiry.toISOString(),
    });

  } catch (error: any) {
    console.error('Renewal trigger error:', error);
    return NextResponse.json({ 
      error: error.message || 'Renewal failed' 
    }, { status: 500 });
  }
}
