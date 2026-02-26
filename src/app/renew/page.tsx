'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Logo } from '@/components/Logo';

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
  { id: 'lifetime', name: 'Lifetime Access', months: 0, price_cents: 39900, connections: 5, savings: 'Best Value' },
];

export default function RenewPage() {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [isNewCustomer, setIsNewCustomer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<Plan>(PLANS[1]); // Default to 6 months
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [saveCard, setSaveCard] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  
  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    checkAuth();
  }, []);

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
      const paymentRes = await fetch('/api/payment/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cardNumber: cardNumber.replace(/\s/g, ''),
          expiry,
          cvv,
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

  function formatCardNumber(value: string) {
    const v = value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
    const matches = v.match(/\d{4,16}/g);
    const match = (matches && matches[0]) || '';
    const parts = [];
    for (let i = 0, len = match.length; i < len; i += 4) {
      parts.push(match.substring(i, i + 4));
    }
    return parts.length ? parts.join(' ') : value;
  }

  function formatExpiry(value: string) {
    const v = value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
    if (v.length >= 2) {
      return v.slice(0, 2) + '/' + v.slice(2, 4);
    }
    return v;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  const daysUntilExpiry = subscription?.expires_at 
    ? Math.ceil((new Date(subscription.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-gray-200 px-6 py-4">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <Link href="/dashboard" className="text-gray-500 hover:text-black text-sm font-medium transition-colors">
            ← Back
          </Link>
          <Link href="/" className="flex items-center gap-2">
            <Logo className="w-6 h-6" />
            <span className="font-bold text-sm tracking-tight">OMEGA TV</span>
          </Link>
        </div>
      </header>

      <div className="max-w-md mx-auto px-6 py-12">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold tracking-tight mb-2">
            {isNewCustomer ? 'GET STARTED' : 'RENEW'}
          </h1>
          <p className="text-gray-500">
            {isNewCustomer 
              ? 'Subscribe to Omega TV' 
              : 'Keep watching without interruption'}
          </p>
        </div>

        {!isNewCustomer && subscription && (
          <div className="border border-gray-200 p-4 mb-6">
            <div className="flex justify-between items-center">
              <div>
                <p className="font-semibold">@{subscription.iptv_username}</p>
                <p className={`text-sm ${
                  daysUntilExpiry && daysUntilExpiry <= 3 ? 'text-red-600' : 
                  daysUntilExpiry && daysUntilExpiry <= 7 ? 'text-yellow-600' : 'text-green-600'
                }`}>
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
          <h3 className="font-bold text-sm uppercase tracking-wide text-gray-500 mb-3">Select Plan</h3>
          <div className="space-y-3">
            {PLANS.map((plan) => (
              <button
                key={plan.id}
                onClick={() => setSelectedPlan(plan)}
                className={`w-full p-4 border text-left transition-all ${
                  selectedPlan.id === plan.id
                    ? 'border-black bg-gray-50'
                    : 'border-gray-200 hover:border-gray-400'
                }`}
              >
                <div className="flex justify-between items-center">
                  <div>
                    <p className="font-semibold">{plan.name}</p>
                    <p className="text-gray-500 text-sm">{plan.connections} Connections{plan.id === 'lifetime' ? ' (5 TVs)' : ''}</p>
                    {plan.savings && (
                      <p className="text-green-600 text-sm font-medium">{plan.savings}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-xl">${(plan.price_cents / 100).toFixed(0)}</p>
                    {plan.months > 1 && (
                      <p className="text-gray-400 text-sm">
                        ${(plan.price_cents / 100 / plan.months).toFixed(0)}/mo
                      </p>
                    )}
                    {plan.id === 'lifetime' && (
                      <p className="text-gray-400 text-sm">One-time payment</p>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Payment Form */}
        <form onSubmit={handlePayment} className="border border-gray-200 p-6">
          <h3 className="font-bold text-sm uppercase tracking-wide text-gray-500 mb-4">Payment Details</h3>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Card Number</label>
              <input
                type="text"
                value={cardNumber}
                onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
                placeholder="1234 5678 9012 3456"
                maxLength={19}
                className="w-full"
                required
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Expiry</label>
                <input
                  type="text"
                  value={expiry}
                  onChange={(e) => setExpiry(formatExpiry(e.target.value))}
                  placeholder="MM/YY"
                  maxLength={5}
                  className="w-full"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">CVV</label>
                <input
                  type="text"
                  value={cvv}
                  onChange={(e) => setCvv(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="123"
                  maxLength={4}
                  className="w-full"
                  required
                />
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={saveCard}
                onChange={(e) => setSaveCard(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-gray-600 text-sm">Save card for auto-renewal</span>
            </label>
          </div>

          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-600 text-sm">
              {error}
            </div>
          )}

          {message && (
            <div className="mt-4 p-3 bg-green-50 border border-green-200 text-green-600 text-sm">
              {message}
            </div>
          )}

          <button
            type="submit"
            disabled={processing}
            className="w-full mt-6 btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {processing 
              ? 'Processing...' 
              : `${isNewCustomer ? 'Subscribe' : 'Renew'} — $${(selectedPlan.price_cents / 100).toFixed(0)}`}
          </button>

          <p className="text-center text-gray-400 text-xs mt-4">
            Secured by BlockChyp • PCI Compliant
          </p>
        </form>
      </div>
    </div>
  );
}
