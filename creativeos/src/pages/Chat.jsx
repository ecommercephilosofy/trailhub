// Chat con el cerebro — mismo contexto que el bot de Telegram (digest semanal
// que publica el pipeline). Edge Function `chat` llama a Claude y guarda el hilo.
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useEntityList } from '@/hooks/useData'
import { ChatMessages } from '@/api/entities'
import { invokeFn } from '@/api/functions'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { LoadingSpinner } from '@/components/shared/misc'
import { Send, MessageCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

export default function Chat() {
  const { user } = useAuth()
  const { data: messages, refetch } = useEntityList(ChatMessages, {
    filter: { user_id: user?.id }, sort: 'created_at', limit: 200, staleTime: 5_000, enabled: !!user,
  })
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState(null)   // pregunta enviada, aún sin respuesta
  const bottomRef = useRef(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, busy])

  const send = async () => {
    const q = input.trim()
    if (!q || busy) return
    setInput('')
    setPending(q)   // burbuja optimista: se ve la pregunta mientras el cerebro responde
    setBusy(true)
    try {
      await invokeFn('chat', { message: q })
      await refetch()
    } catch (e) {
      toast.error(`El chat falló: ${e.message}`)
      setInput(q)   // no perder lo escrito
    } finally {
      setBusy(false)
      setPending(null)
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-3xl flex-col">
      <div className="flex-1 overflow-y-auto scrollbar-thin space-y-3 pb-4">
        {!messages?.length && (
          <div className="mt-16 text-center text-slate-400">
            <MessageCircle className="mx-auto h-10 w-10 mb-3" />
            <p className="text-sm">Pregunta lo que quieras sobre la cuenta:</p>
            <p className="text-xs mt-2">«¿qué ad escalo esta semana?» · «¿por qué cayó el ROAS en MX?»<br />
              «¿qué briefs de la semana pasada funcionaron?»</p>
          </div>
        )}
        {(messages || []).map((m) => (
          <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div className={cn('max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap',
              m.role === 'user'
                ? 'bg-indigo-600 text-white rounded-br-sm'
                : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm shadow-sm')}>
              {m.content}
            </div>
          </div>
        ))}
        {pending && (
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600/70 px-4 py-2.5 text-sm text-white whitespace-pre-wrap">{pending}</div>
          </div>
        )}
        {busy && <div className="flex justify-start"><div className="rounded-2xl bg-white border border-slate-200 px-4 py-3"><LoadingSpinner size="sm" /></div></div>}
        <div ref={bottomRef} />
      </div>
      <div className="flex gap-2 border-t border-slate-200 pt-3">
        <Textarea rows={1} value={input} onChange={(e) => setInput(e.target.value)}
                  placeholder="Pregunta al cerebro…"
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                  className="resize-none" />
        <Button onClick={send} disabled={busy || !input.trim()}><Send className="h-4 w-4" /></Button>
      </div>
    </div>
  )
}
