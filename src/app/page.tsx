'use client';

import { useState, useRef, useEffect } from 'react';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  buttons?: { label: string; value: string }[];
}

const QUICK_OPTIONS = [
  { label: '🆕 New Subscription', value: 'I want to sign up for a new subscription' },
  { label: '🔄 Renew / Pay', value: 'I need to renew my subscription' },
  { label: '🔧 Troubleshooting', value: 'I need help with a technical issue' },
  { label: '📱 Setup Help', value: 'I need help setting up the app' },
  { label: '💬 Something Else', value: 'I have a different question' },
];

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: 'Welcome to Omega TV! 👋\n\nI\'m here to help you with subscriptions, troubleshooting, setup, and more.\n\nWhat can I help you with today?',
      buttons: QUICK_OPTIONS.map(opt => ({ label: opt.label, value: opt.value })),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: text,
          history: messages.map(m => ({ role: m.role, content: m.content }))
        }),
      });

      const data = await response.json();

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.message,
        buttons: data.buttons,
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      setMessages(prev => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: 'Sorry, something went wrong. Please try again or text us at (270) 238-5765.',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleButtonClick = (value: string) => {
    sendMessage(value);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex flex-col">
      {/* Header */}
      <header className="p-4 text-center border-b border-white/10">
        <h1 className="text-2xl font-bold text-white">
          <span className="text-purple-400">Ω</span> OMEGA TV
        </h1>
        <p className="text-gray-400 text-sm">Premium Streaming • Unlimited Entertainment</p>
      </header>

      {/* Chat Container */}
      <div className="flex-1 max-w-2xl mx-auto w-full flex flex-col p-4">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto space-y-4 pb-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                  message.role === 'user'
                    ? 'bg-purple-600 text-white'
                    : 'bg-white/10 text-white'
                }`}
              >
                <p className="whitespace-pre-wrap">{message.content}</p>
                
                {message.buttons && message.buttons.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {message.buttons.map((btn, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleButtonClick(btn.value)}
                        className="w-full text-left px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors text-sm"
                        disabled={loading}
                      >
                        {btn.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          
          {loading && (
            <div className="flex justify-start">
              <div className="bg-white/10 rounded-2xl px-4 py-3">
                <div className="flex space-x-2">
                  <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" />
                  <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                  <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                </div>
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="flex gap-2 pt-4 border-t border-white/10">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 bg-white/10 text-white placeholder-gray-400 rounded-full px-5 py-3 focus:outline-none focus:ring-2 focus:ring-purple-500"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-full px-6 py-3 font-medium transition-colors"
          >
            Send
          </button>
        </form>
      </div>

      {/* Footer */}
      <footer className="p-4 text-center text-gray-500 text-sm border-t border-white/10">
        <p>Need immediate help? Text us at <a href="sms:+12702385765" className="text-purple-400">(270) 238-5765</a></p>
      </footer>
    </div>
  );
}
