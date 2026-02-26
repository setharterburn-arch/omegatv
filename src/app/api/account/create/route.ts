import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, adminSupabase } from '@/lib/supabase-server';

const IPTV_PANEL_URL = process.env.IPTV_PANEL_URL!;
const IPTV_PANEL_USER = process.env.IPTV_PANEL_USER!;
const IPTV_PANEL_PASS = process.env.IPTV_PANEL_PASS!;

const PUSHOVER_USER = process.env.PUSHOVER_USER_KEY;
const PUSHOVER_TOKEN = process.env.PUSHOVER_APP_TOKEN;

async function sendPushover(title: string, message: string, priority: number = 0) {
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
        priority,
      }),
    });
  } catch (err) {
    console.error('Pushover failed:', err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createServerSupabase();
    
    // Verify auth
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { paymentId, planMonths = 1 } = await req.json();

    // Get user details
    const customerName = user.user_metadata?.name || user.email?.split('@')[0] || 'customer';
    const customerEmail = user.email || '';
    const customerPhone = user.user_metadata?.phone || user.phone || '';

    console.log(`[CREATE] Creating IPTV account for ${customerName}`);

    // Call the automation service to create the account
    const createResponse = await fetch('http://localhost:3007/api/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName,
        customerEmail,
        planMonths,
        panelUrl: IPTV_PANEL_URL,
        panelUser: IPTV_PANEL_USER,
        panelPass: IPTV_PANEL_PASS,
      }),
    });

    if (!createResponse.ok) {
      const errorData = await createResponse.json().catch(() => ({}));
      console.error('[CREATE] Automation failed:', errorData);
      
      // Mark for manual creation
      const phoneInfo = customerPhone ? `\nPhone: ${customerPhone}` : '';
      await sendPushover(
        '⚠️ Omega TV: Manual Creation Needed',
        `Failed to auto-create account for:\n${customerName}\n${customerEmail}${phoneInfo}\n\nPayment ID: ${paymentId}`,
        1
      );
      
      return NextResponse.json({ 
        error: 'Account creation failed - will be processed manually',
        needsManualCreation: true,
      }, { status: 500 });
    }

    const createResult = await createResponse.json();

    // Calculate expiry (lifetime = no expiry)
    const isLifetime = planMonths === 0;
    const expiresAt = isLifetime ? null : new Date();
    if (expiresAt) {
      expiresAt.setMonth(expiresAt.getMonth() + planMonths);
    }

    // Determine plan name and price
    const planName = isLifetime ? 'Lifetime Access' : `${planMonths} Month`;
    const priceCents = isLifetime ? 39900 : planMonths * 2500;

    // Save to database
    const { error: dbError } = await adminSupabase
      .from('user_subscriptions')
      .upsert({
        user_id: user.id,
        iptv_username: createResult.username,
        iptv_password: createResult.password,
        status: 'active',
        expires_at: expiresAt ? expiresAt.toISOString() : null,
        plan_name: planName,
        price_cents: priceCents,
      }, {
        onConflict: 'user_id',
      });

    if (dbError) {
      console.error('[CREATE] Failed to save to database:', dbError);
    }

    // Update payment record if provided
    if (paymentId) {
      await adminSupabase
        .from('payments')
        .update({ status: 'completed' })
        .eq('id', paymentId);
    }

    // Remove from pending matches if exists
    await adminSupabase
      .from('pending_matches')
      .delete()
      .eq('user_id', user.id);

    // Send success notification
    const phoneDisplay = customerPhone ? `\nPhone: ${customerPhone}` : '';
    await sendPushover(
      '🆕 Omega TV: Account Created',
      `${customerName}${phoneDisplay}\nUsername: ${createResult.username}\nExpires: ${expiresAt.toLocaleDateString()}`,
      -1
    );

    return NextResponse.json({
      success: true,
      username: createResult.username,
      password: createResult.password,
      expiresAt: expiresAt.toISOString(),
    });

  } catch (error: any) {
    console.error('[CREATE] Error:', error);
    return NextResponse.json({ 
      error: error.message || 'Account creation failed' 
    }, { status: 500 });
  }
}
