import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, adminSupabase } from '@/lib/supabase-server';
import crypto from 'crypto';

const BLOCKCHYP_API_KEY = process.env.BLOCKCHYP_API_KEY!;
const BLOCKCHYP_BEARER_TOKEN = process.env.BLOCKCHYP_BEARER_TOKEN!;
const BLOCKCHYP_SIGNING_KEY = process.env.BLOCKCHYP_SIGNING_KEY!;
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
        sound: 'cashregister',
      }),
    });
  } catch (err) {
    console.error('Pushover failed:', err);
  }
}

function generateBlockChypHeaders() {
  const timestamp = new Date().toISOString();
  const nonce = crypto.randomBytes(32).toString('hex');
  
  // Per BlockChyp SDK: signature = HMAC-SHA256(signingKey, apiKey + bearerToken + timestamp + nonce)
  // The request body is NOT included in the signature
  const toSign = BLOCKCHYP_API_KEY + BLOCKCHYP_BEARER_TOKEN + timestamp + nonce;
  const signature = crypto
    .createHmac('sha256', Buffer.from(BLOCKCHYP_SIGNING_KEY, 'hex'))
    .update(toSign)
    .digest('hex');

  return {
    'Content-Type': 'application/json',
    'Authorization': `Dual ${BLOCKCHYP_BEARER_TOKEN}:${BLOCKCHYP_API_KEY}:${signature}`,
    'Nonce': nonce,
    'Timestamp': timestamp,
  };
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createServerSupabase();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { cardNumber, expiry, cvv, saveCard, subscriptionId, amountCents: providedAmount, planName: providedPlanName } = await req.json();

    if (!cardNumber || !expiry || !cvv) {
      return NextResponse.json({ error: 'Missing card details' }, { status: 400 });
    }

    // Always use frontend-provided amount (what user selected)
    // Only fall back to DB or default if not provided
    let amountCents = providedAmount;
    let planName = providedPlanName || '1 Month';

    // Validate amount is one of our valid plans
    const validAmounts = [2000, 9000, 15000]; // $20, $90, $150
    if (!amountCents || !validAmounts.includes(amountCents)) {
      console.error('Invalid amount received:', amountCents);
      return NextResponse.json({ error: 'Invalid plan selected' }, { status: 400 });
    }

    const [expMonth, expYear] = expiry.split('/');

    // BlockChyp charge - manual entry, production mode
    const chargeBody = JSON.stringify({
      manualEntry: true,
      amount: (amountCents / 100).toFixed(2),
      pan: cardNumber.replace(/\s/g, ''),
      expMonth: expMonth.padStart(2, '0'),
      expYear: '20' + expYear,
      cvv,
      description: `Omega TV - ${planName}`,
      enroll: saveCard || false,
    });

    const headers = generateBlockChypHeaders();
    
    const response = await fetch('https://api.blockchyp.com/api/charge', {
      method: 'POST',
      headers,
      body: chargeBody,
    });

    const result = await response.json();

    if (!result.approved) {
      console.error('BlockChyp decline:', result.responseDescription);
      return NextResponse.json({ 
        error: result.responseDescription || 'Payment declined' 
      }, { status: 400 });
    }

    // Save payment record
    const { data: payment, error: paymentError } = await adminSupabase
      .from('payments')
      .insert({
        user_id: user.id,
        subscription_id: subscriptionId || null,
        amount_cents: amountCents,
        blockchyp_transaction_id: result.transactionId,
        status: 'pending',
      })
      .select()
      .single();

    if (paymentError) {
      console.error('Failed to save payment record:', paymentError);
    }

    if (saveCard && result.token && subscriptionId) {
      await adminSupabase
        .from('user_subscriptions')
        .update({ 
          blockchyp_token: result.token,
          auto_renew: true,
        })
        .eq('id', subscriptionId);
    }

    // Notify Seth
    const userEmail = user.email || 'unknown';
    const userName = user.user_metadata?.name || userEmail;
    const userPhone = user.user_metadata?.phone || user.phone || '';
    const phoneDisplay = userPhone ? `\nPhone: ${userPhone}` : '';
    await sendPushover(
      '💰 Omega TV: Payment Received',
      `${userName} (${userEmail})${phoneDisplay}\nPlan: ${planName}\nAmount: $${(amountCents / 100).toFixed(2)}\nTx: ${result.transactionId}\n\nGo link their IPTV account in admin panel.`,
      1
    );

    return NextResponse.json({
      success: true,
      paymentId: payment?.id,
      transactionId: result.transactionId,
      message: 'Payment successful',
    });

  } catch (error: any) {
    console.error('Payment error:', error);
    return NextResponse.json({ 
      error: error.message || 'Payment processing failed' 
    }, { status: 500 });
  }
}
