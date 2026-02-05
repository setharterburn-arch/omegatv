'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import Script from 'next/script';

interface Subscription {
  id: string;
  iptv_username: string;
  plan_name: string;
  price_cents: number;
  status: string;
  expires_at: string | null;
  auto_renew: boolean;
}

interface Plan {
  id: string;
  name: string;
  months: number;
  price_cents: number;
  connections: number;
  savings?: string;
}

const PLANS: Plan[] = [
  { id: '1mo', name: '1 Month', months: 1, price_cents: 2000, connections: 3 },
  { id: '6mo', name: '6 Months', months: 6, price_cents: 9000, connections: 3, savings: 'Save $30' },
  { id: '12mo', name: '12 Months', months: 12, price_cents: 15000, connections: 3, savings: 'Save $90' },
];

declare global {
  interface Window {
    tokenizer: any;
  }
}

export default function RenewPage() {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [isNewCustomer, setIsNewCustomer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<Plan>(PLANS[0]);
  const [saveCard, setSaveCard] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [tokenizerReady, setTokenizerReady] = useState(false);
  const tokenizerRef = useRef<any>(null);
  
  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    checkAuth();
  }, []);

  function initTokenizer() {
    if (typeof window !== 'undefined' && window.tokenizer && !tokenizerRef.current) {
      try {
        tokenizerRef.current = window.tokenizer;
        tokenizerRef.current.render(
          process.env.NEXT_PUBLIC_BLOCKCHYP_TOKENIZING_KEY || '',
          true, // test mode
          'secure-input',
          {
            placeholder: 'Card Number',
          }
        );
        setTokenizerReady(true);
      } catch (err) {
        console.error('Tokenizer init error:', err);
      }
    }
  }

  async function checkAuth() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.push('/login');
      return;
    }
    fetchSubscription();
  }

  async function fetchSubscription() {
    try {
      const res = await fetch('/api/subscription');
      const data = await res.json();
      if (data.subscription && data.subscription.iptv_username) {
        setSubscription(data.subscription);
        setIsNewCustomer(false);
      } else {
        setIsNewCustomer(true);
      }
    } catch (err) {
      console.error('Failed to fetch subscription:', err);
      setIsNewCustomer(true);
    } finally {
      setLoading(false);
    }
  }

  async function handlePayment(e: React.FormEvent) {
    e.preventDefault();
    
    setProcessing(true);
    setError('');
    setMessage('');

    try {
      // Tokenize card via BlockChyp iframe
      if (!tokenizerRef.current) {
        throw new Error('Payment system not loaded. Please refresh and try again.');
      }

      const tokenEvent = await tokenizerRef.current.tokenize(
        process.env.NEXT_PUBLIC_BLOCKCHYP_TOKENIZING_KEY || '',
        { test: false }
      );

      const tokenData = tokenEvent?.data || tokenEvent;

      if (!tokenData?.success && !tokenData?.token) {
        throw new Error(tokenData?.responseDescription || tokenData?.error || 'Failed to process card. Please check your details and try again.');
      }

      const token = tokenData.token;

      // Send token to server for charging
      const paymentRes = await fetch('/api/payment/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          saveCard,
          subscriptionId: subscription?.id,
          amountCents: selectedPlan.price_cents,
          planName: selectedPlan.name,
        }),
      });

      const paymentData = await paymentRes.json();

      if (!paymentRes.ok) {
        throw new Error(paymentData.error || 'Payment failed');
      }

      if (isNewCustomer) {
        setMessage('✅ Payment received! Your IPTV account will be set up shortly. You\'ll receive your login credentials soon.');
        return;
      } else {
        const renewRes = await fetch('/api/renew/trigger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscriptionId: subscription?.id,
            paymentId: paymentData.paymentId,
            planMonths: selectedPlan.months,
          }),
        });

        if (renewRes.ok) {
          setMessage('✅ Payment complete and subscription renewed! Redirecting...');
          setTimeout(() => router.push('/dashboard'), 2000);
        } else {
          setMessage('⚠️ Payment complete but renewal pending. We\'ll process it shortly.');
          setTimeout(() => router.push('/dashboard'), 3000);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Payment failed');
    } finally {
      setProcessing(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-black to-purple-950 flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  const daysUntilExpiry = subscription?.expires_at 
    ? Math.ceil((new Date(subscription.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-black to-purple-950 p-4">
      <Script 
        src="https://api.blockchyp.com/static/js/blockchyp-tokenizer-all.min.js"
        onLoad={initTokenizer}
      />
      
      <div className="max-w-md mx-auto pt-12">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">
            {isNewCustomer ? 'Get Started' : 'Renew Subscription'}
          </h1>
          <p className="text-gray-400">
            {isNewCustomer 
              ? 'Subscribe to Omega TV and start streaming' 
              : 'Keep watching without interruption'}
          </p>
        </div>

        {/* Current Subscription Info (for existing customers) */}
        {!isNewCustomer && subscription && (
          <div className="bg-black/50 backdrop-blur-xl rounded-2xl p-4 mb-6 border border-purple-500/30">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-white font-semibold">@{subscription.iptv_username}</p>
                <p className={`text-sm ${daysUntilExpiry && daysUntilExpiry <= 3 ? 'text-red-400' : daysUntilExpiry && daysUntilExpiry <= 7 ? 'text-yellow-400' : 'text-green-400'}`}>
                  {daysUntilExpiry !== null 
                    ? daysUntilExpiry > 0 
                      ? `Expires in ${daysUntilExpiry} days`
                      : 'Expired'
                    : subscription.status}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Plan Selection */}
        <div className="mb-6">
          <h3 className="text-white font-semibold mb-3">Select Plan</h3>
          <div className="space-y-3">
            {PLANS.map((plan) => (
              <button
                key={plan.id}
                onClick={() => setSelectedPlan(plan)}
                className={`w-full p-4 rounded-xl border transition-all text-left ${
                  selectedPlan.id === plan.id
                    ? 'border-purple-500 bg-purple-500/20'
                    : 'border-gray-700 bg-black/30 hover:border-gray-600'
                }`}
              >
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-white font-semibold">{plan.name}</p>
                    <p className="text-gray-400 text-sm">{plan.connections} Connections</p>
                    {plan.savings && (
                      <p className="text-green-400 text-sm">{plan.savings}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-white font-bold text-xl">${(plan.price_cents / 100).toFixed(2)}</p>
                    {plan.months > 1 && (
                      <p className="text-gray-400 text-sm">
                        ${(plan.price_cents / 100 / plan.months).toFixed(2)}/mo
                      </p>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* New Customer Features */}
        {isNewCustomer && (
          <div className="bg-black/30 rounded-xl p-4 mb-6 border border-purple-500/20">
            <p className="text-gray-300 text-sm font-semibold mb-2">What you get:</p>
            <ul className="text-sm text-gray-400 space-y-1">
              <li>✓ 10,000+ Live TV Channels</li>
              <li>✓ Movies & TV Shows on Demand</li>
              <li>✓ Works on all devices</li>
              <li>✓ 3 Simultaneous Connections</li>
            </ul>
          </div>
        )}

        {/* Payment Form */}
        <form onSubmit={handlePayment} className="bg-black/50 backdrop-blur-xl rounded-2xl p-6 border border-purple-500/30">
          <h3 className="text-white font-semibold mb-4">Payment Details</h3>
          
          <div className="space-y-4">
            <div>
              <label className="block text-gray-400 text-sm mb-1">Card Details</label>
              <div 
                id="secure-input" 
                className="w-full bg-black/50 border border-gray-700 rounded-lg px-4 py-3 min-h-[48px]"
                style={{ minHeight: '48px' }}
              />
              <div id="secure-input-error" className="text-red-400 text-sm mt-1" style={{ display: 'none' }} />
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={saveCard}
                onChange={(e) => setSaveCard(e.target.checked)}
                className="w-4 h-4 rounded border-gray-700 bg-black/50 text-purple-600 focus:ring-purple-500"
              />
              <span className="text-gray-400 text-sm">Save card for auto-renewal</span>
            </label>
          </div>

          {error && (
            <div className="mt-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          {message && (
            <div className="mt-4 p-3 bg-green-500/20 border border-green-500/50 rounded-lg text-green-400 text-sm">
              {message}
            </div>
          )}

          <button
            type="submit"
            disabled={processing || !tokenizerReady}
            className="w-full mt-6 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed text-white py-4 rounded-xl font-bold text-lg transition-all"
          >
            {processing 
              ? 'Processing...' 
              : !tokenizerReady
              ? 'Loading payment...'
              : `${isNewCustomer ? 'Subscribe' : 'Renew'} - $${(selectedPlan.price_cents / 100).toFixed(2)}`}
          </button>

          <p className="text-center text-gray-500 text-xs mt-4">
            Secured by BlockChyp • PCI Compliant
          </p>
        </form>

        {/* Back Button */}
        <button
          onClick={() => router.push('/dashboard')}
          className="w-full mt-4 text-gray-400 hover:text-white py-3 transition-colors"
        >
          ← Back to Dashboard
        </button>
      </div>
    </div>
  );
}
