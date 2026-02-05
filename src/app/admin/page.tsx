'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Logo } from '@/components/Logo';

interface SupportRequest {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  status: string;
  created_at: string;
}

interface PendingMatch {
  id: string;
  user_id: string;
  user_name: string;
  user_phone: string;
  user_email: string;
  matched_iptv_username: string | null;
  match_confidence: number | null;
  status: string;
  created_at: string;
}

interface Subscription {
  id: string;
  user_id: string;
  iptv_username: string;
  status: string;
  expires_at: string | null;
  created_at: string;
}

export default function AdminPage() {
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('support');
  
  const [supportRequests, setSupportRequests] = useState<SupportRequest[]>([]);
  const [pendingMatches, setPendingMatches] = useState<PendingMatch[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  
  const [expandedRequest, setExpandedRequest] = useState<string | null>(null);
  const [linkModal, setLinkModal] = useState<{ userId: string; email: string } | null>(null);
  const [iptvUsername, setIptvUsername] = useState('');
  const [iptvPassword, setIptvPassword] = useState('');
  
  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push('/login');
      return;
    }
    try {
      const res = await fetch('/api/admin/data');
      if (res.status === 401) {
        router.push('/dashboard');
        return;
      }
      const data = await res.json();
      setSupportRequests(data.supportRequests || []);
      setPendingMatches(data.pendingMatches || []);
      setSubscriptions(data.subscriptions || []);
      setAuthorized(true);
    } catch {
      router.push('/dashboard');
    } finally {
      setLoading(false);
    }
  }

  async function loadData() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/data');
      const data = await res.json();
      setSupportRequests(data.supportRequests || []);
      setPendingMatches(data.pendingMatches || []);
      setSubscriptions(data.subscriptions || []);
    } catch (err) {
      console.error('Failed to load admin data:', err);
    } finally {
      setLoading(false);
    }
  }

  async function resolveRequest(id: string) {
    await fetch('/api/admin/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, type: 'support' }),
    });
    loadData();
  }

  async function linkAccount(userId: string) {
    if (!iptvUsername) return;
    
    await fetch('/api/admin/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        userId, 
        iptvUsername,
        iptvPassword: iptvPassword || undefined,
      }),
    });
    
    setLinkModal(null);
    setIptvUsername('');
    setIptvPassword('');
    loadData();
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  if (!authorized || loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-gray-500">{loading ? 'Loading...' : 'Checking authorization...'}</div>
      </div>
    );
  }

  const openRequests = supportRequests.filter(r => r.status === 'open');
  const pendingLinks = pendingMatches.filter(m => m.status === 'pending');
  const expiringSoon = subscriptions.filter(s => {
    if (!s.expires_at) return false;
    const days = Math.ceil((new Date(s.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return days <= 7 && days > 0;
  });

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <Logo className="w-8 h-8" />
            <span className="text-lg font-bold tracking-tight">OMEGA TV ADMIN</span>
          </Link>
          <button 
            onClick={loadData} 
            className="text-gray-400 hover:text-black text-sm font-medium transition-colors"
          >
            {loading ? '↻ Loading...' : '↻ Refresh'}
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Stats */}
        <div className="grid md:grid-cols-3 gap-4 mb-8">
          <div className="border border-gray-200 p-4 flex items-center gap-4">
            <span className="text-3xl">💬</span>
            <div>
              <p className="text-2xl font-bold">{openRequests.length}</p>
              <p className="text-sm text-gray-500">Open Requests</p>
            </div>
          </div>
          <div className="border border-gray-200 p-4 flex items-center gap-4">
            <span className="text-3xl">🔗</span>
            <div>
              <p className="text-2xl font-bold">{pendingLinks.length}</p>
              <p className="text-sm text-gray-500">Pending Links</p>
            </div>
          </div>
          <div className="border border-gray-200 p-4 flex items-center gap-4">
            <span className="text-3xl">⏰</span>
            <div>
              <p className="text-2xl font-bold">{expiringSoon.length}</p>
              <p className="text-sm text-gray-500">Expiring Soon</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b border-gray-200">
          {[
            { id: 'support', label: 'Support', count: openRequests.length },
            { id: 'pending', label: 'Pending Links', count: pendingLinks.length },
            { id: 'users', label: 'All Users', count: subscriptions.length },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 font-medium text-sm uppercase tracking-wide transition-colors border-b-2 -mb-px ${
                activeTab === tab.id
                  ? 'border-black text-black'
                  : 'border-transparent text-gray-400 hover:text-black'
              }`}
            >
              {tab.label}
              {tab.count > 0 && (
                <span className="ml-2 bg-gray-100 px-2 py-0.5 text-xs">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="border border-gray-200">
          {activeTab === 'support' && (
            <div className="divide-y divide-gray-200">
              {supportRequests.length === 0 ? (
                <div className="p-8 text-center text-gray-400">No support requests yet</div>
              ) : (
                supportRequests.map(req => (
                  <div key={req.id} className="p-4">
                    <div 
                      className="flex items-start justify-between cursor-pointer"
                      onClick={() => setExpandedRequest(expandedRequest === req.id ? null : req.id)}
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`w-2 h-2 rounded-full ${
                            req.status === 'open' ? 'bg-yellow-400' : 'bg-green-400'
                          }`} />
                          <span className="font-medium">{req.subject}</span>
                          <span className="text-sm text-gray-400">{formatDate(req.created_at)}</span>
                        </div>
                        <p className="text-sm text-gray-500">{req.name} • {req.email}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {req.status === 'open' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); resolveRequest(req.id); }}
                            className="p-2 hover:bg-gray-100 transition-colors text-green-600"
                            title="Mark resolved"
                          >
                            ✓
                          </button>
                        )}
                        <span className="text-gray-400">{expandedRequest === req.id ? '▲' : '▼'}</span>
                      </div>
                    </div>
                    {expandedRequest === req.id && (
                      <div className="mt-3 p-3 bg-gray-50">
                        <p className="whitespace-pre-wrap text-sm">{req.message}</p>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'pending' && (
            <div className="divide-y divide-gray-200">
              {pendingMatches.length === 0 ? (
                <div className="p-8 text-center text-gray-400">No pending account links</div>
              ) : (
                pendingMatches.map(match => (
                  <div key={match.id} className="p-4 flex items-center justify-between">
                    <div>
                      <p className="font-medium">{match.user_name || match.user_email}</p>
                      <p className="text-sm text-gray-500">
                        {match.user_phone && `📱 ${match.user_phone} • `}
                        {match.user_email}
                      </p>
                      {match.matched_iptv_username && (
                        <p className="text-sm text-blue-600 mt-1">
                          Possible match: {match.matched_iptv_username} ({Math.round((match.match_confidence || 0) * 100)}%)
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => setLinkModal({ userId: match.user_id, email: match.user_email })}
                      className="btn-primary text-sm"
                    >
                      Link
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'users' && (
            <div className="divide-y divide-gray-200">
              {subscriptions.length === 0 ? (
                <div className="p-8 text-center text-gray-400">No linked users yet</div>
              ) : (
                subscriptions.map(sub => {
                  const daysLeft = sub.expires_at 
                    ? Math.ceil((new Date(sub.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                    : null;
                  return (
                    <div key={sub.id} className="p-4 flex items-center justify-between">
                      <div>
                        <p className="font-medium">@{sub.iptv_username}</p>
                        <p className="text-sm text-gray-500">
                          {sub.status === 'active' ? (
                            <span className="text-green-600">Active</span>
                          ) : (
                            <span className="text-red-600">{sub.status}</span>
                          )}
                          {daysLeft !== null && (
                            <span className={`ml-2 ${daysLeft <= 3 ? 'text-red-600' : daysLeft <= 7 ? 'text-yellow-600' : 'text-gray-400'}`}>
                              • {daysLeft > 0 ? `${daysLeft} days left` : 'Expired'}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </main>

      {/* Link Account Modal */}
      {linkModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-gray-200 p-6 max-w-md w-full">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">LINK IPTV ACCOUNT</h2>
              <button onClick={() => setLinkModal(null)} className="text-gray-400 hover:text-black text-xl">
                ×
              </button>
            </div>
            <p className="text-gray-500 mb-4">Linking account for: {linkModal.email}</p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">IPTV Username</label>
                <input
                  type="text"
                  value={iptvUsername}
                  onChange={(e) => setIptvUsername(e.target.value)}
                  placeholder="username from panel"
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">IPTV Password (optional)</label>
                <input
                  type="text"
                  value={iptvPassword}
                  onChange={(e) => setIptvPassword(e.target.value)}
                  placeholder="password if known"
                  className="w-full"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setLinkModal(null)}
                className="flex-1 btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={() => linkAccount(linkModal.userId)}
                disabled={!iptvUsername}
                className="flex-1 btn-primary disabled:opacity-50"
              >
                Link Account
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
