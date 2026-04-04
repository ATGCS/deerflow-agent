import { useState, useEffect, useCallback } from 'react'
import { messagesToDisplayRows, parseUsageToStats } from '../../lib/chat-normalize.js'
import type { DisplayRow, TokenTotals } from '../chat-types.js'

export function useThreadHistory(sessionKey: string | null) {
  const [rows, setRows] = useState<DisplayRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tokenTotals, setTokenTotals] = useState<TokenTotals | null>(null)

  const reload = useCallback(async () => {
    if (!sessionKey) {
      setRows([])
      setTokenTotals(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const { api } = await import('../../lib/tauri-api.js')
      const result = await api.chatHistory(sessionKey, 200)
      const raw = (result?.messages || []) as unknown[]
      const usageTotals = raw.reduce<TokenTotals>(
        (acc, m) => {
          const u = parseUsageToStats(m) as TokenTotals | null | undefined
          if (!u) return acc
          acc.input += u.input
          acc.output += u.output
          acc.total += u.total
          return acc
        },
        { input: 0, output: 0, total: 0 },
      )
      if (usageTotals.total > 0) {
        setTokenTotals(usageTotals)
      } else {
        setTokenTotals(null)
      }
      setRows(messagesToDisplayRows(raw) as DisplayRow[])
    } catch (e) {
      setError(String((e as Error)?.message || e))
      setRows([])
      setTokenTotals(null)
    } finally {
      setLoading(false)
    }
  }, [sessionKey])

  useEffect(() => {
    void reload()
  }, [reload])

  return { rows, setRows, loading, error, reload, tokenTotals, setTokenTotals }
}
