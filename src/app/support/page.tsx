'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { Logo } from '@/components/Logo'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  buttons?: { label: string; value: string }[]
}

const QUICK_OPTIONS = [
  { label: '🔗 Link my account', value: 'I need help linking my IPTV account' },
  { label: '🔄 Renew subscription', value: 'I need to renew my subscription' },
  { label: '🔧 Technical issue', value: 'I need help with a technical issue' },
  { label: '📱 Setup help', value: 'I need help setting up the app' },
  { label: '💬 Something else', value: 'I have a different question' },
]

const generateSessionId = () => Math.random().toString(36).substring(2) + Date.now().toString(36)

export default function SupportPage() {
  const [sessionId] = useState(() => generateSessionId())
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: 'Hi! 👋 I\'m here to help with your Omega TV account.\n\nWhat can I assist you with today?',
      buttons: QUICK_OPTIONS.map(opt => ({ label: opt.label, value: opt.value })),
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showOptions, setShowOptions] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
    }
    setMessages(prev => [...prev, userMessage])
    setInput('')
    setLoading(true)
    setShowOptions(false)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId }),
      })
      const data = await res.json()

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.message || data.response,
        buttons: data.buttons,
      }

      setMessages(prev => [...prev, assistantMessage])
    } catch {
      setMessages(prev => [
        ...prev,
        { 
          id: (Date.now() + 1).toString(), 
          role: 'assistant', 
          content: 'Sorry, something went wrong. Please try again in a moment.' 
        },
      ])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-200 px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <Link href="/dashboard" className="text-gray-500 hover:text-black text-sm font-medium transition-colors">
            ← Back to Dashboard
          </Link>
          <Link href="/" className="flex items-center gap-2">
            <Logo className="w-6 h-6" />
            <span className="font-bold text-sm tracking-tight">OMEGA TV</span>
          </Link>
        </div>
      </header>

      {/* Chat Container */}
      <div className="flex-1 max-w-2xl mx-auto w-full flex flex-col p-4">
        <div className="border border-gray-200 flex-1 flex flex-col overflow-hidden">
          {/* Chat Header */}
          <div className="p-4 border-b border-gray-200">
            <h1 className="text-lg font-bold tracking-tight">SUPPORT CHAT</h1>
            <p className="text-gray-400 text-sm">We typically respond instantly</p>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] px-4 py-3 ${
                  msg.role === 'user'
                    ? 'bg-black text-white'
                    : 'bg-white border border-gray-200 text-black'
                }`}>
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                  {msg.buttons && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {msg.buttons.map((btn, idx) => (
                        <button
                          key={idx}
                          onClick={() => sendMessage(btn.value)}
                          disabled={loading}
                          className="bg-gray-100 hover:bg-gray-200 text-black text-sm px-3 py-2 transition-colors disabled:opacity-50"
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
                <div className="bg-white border border-gray-200 px-4 py-3">
                  <div className="flex space-x-2">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-4 border-t border-gray-200 bg-white">
            <p className="text-center text-gray-400 text-xs mb-3">
              Still stuck? Email us at{' '}
              <a href="mailto:support@getomegatv.com" className="text-black hover:underline">
                support@getomegatv.com
              </a>
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowOptions(!showOptions)}
                className="bg-gray-100 hover:bg-gray-200 text-black p-3 transition-colors"
              >
                ☰
              </button>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendMessage(input)}
                placeholder="Type a message..."
                disabled={loading}
                className="flex-1 disabled:opacity-50"
              />
              <button
                onClick={() => sendMessage(input)}
                disabled={loading || !input.trim()}
                className="btn-primary px-4 disabled:opacity-50"
              >
                Send
              </button>
            </div>
            {showOptions && (
              <div className="mt-3 flex flex-wrap gap-2">
                {QUICK_OPTIONS.map((opt, idx) => (
                  <button
                    key={idx}
                    onClick={() => sendMessage(opt.value)}
                    className="bg-gray-100 hover:bg-gray-200 text-black text-sm px-3 py-2 transition-colors"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
