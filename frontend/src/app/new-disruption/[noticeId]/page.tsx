'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { apiClient } from '@/lib/api-client'
import { Card, CardContent } from '@/components/ui/card'
import { CardWatermark } from '@/components/ui/card-watermark'
import { Icons } from '@/components/ui/icons'

// A dedicated, shareable/bookmarkable page for a single disruption notice —
// pulled out of the New Disruption list (which used to just swap an inline
// panel on the same page) so reviewing a past case is a real page
// navigation with its own URL, giving each decision an auditable trail
// rather than transient client-side state.

interface NoticeStatus {
  notice_id: string
  disruption_notice: Record<string, unknown> | null
  run_context: Record<string, unknown> | null
  incident: Record<string, unknown> | null
  workbench_item: Record<string, unknown> | null
  stage: 'submitted' | 'processing' | 'awaiting_human' | 'resolved' | 'escalated' | 'auto_resolved'
}

const STAGE_LABELS: Record<NoticeStatus['stage'], string> = {
  submitted: 'Submitted',
  processing: 'Processing (Auto)',
  awaiting_human: 'Awaiting Human',
  auto_resolved: 'Auto-Resolved',
  escalated: 'Escalated',
  resolved: 'Resolved',
}

const TERMINAL_STAGES: NoticeStatus['stage'][] = ['resolved', 'auto_resolved', 'escalated']

function pathForStatus(status: NoticeStatus): NoticeStatus['stage'][] {
  const wentToHuman = !!status.workbench_item
  if (wentToHuman) return ['submitted', 'processing', 'awaiting_human', 'resolved']
  if (status.stage === 'escalated') return ['submitted', 'processing', 'escalated']
  return ['submitted', 'processing', 'auto_resolved']
}

// Matches by prefix: this Command Center's own decide endpoint writes
// "approve"/"reject"/"modify", but Auto's separate Slack-based Commander
// Approval flow writes straight to Supabase using its own past-tense
// vocabulary ("approved"/"rejected") — both need to be recognized here.
function isRejectDecision(value: string | null): boolean {
  return (value || '').toLowerCase().startsWith('reject')
}

// Matches the color scheme used everywhere else severity is shown
// (Workbench's severityConfig, AI Insights' getSeverityConfig, and the
// New Disruption list page's severityBadgeClass).
function severityBadgeClass(severity: string | null): string {
  switch ((severity || '').toLowerCase()) {
    case 'critical':
      return 'bg-red-100 text-red-700'
    case 'high':
      return 'bg-red-100 text-red-600'
    case 'warning':
    case 'medium':
      return 'bg-amber-100 text-amber-700'
    case 'low':
      return 'bg-sky-100 text-sky-600'
    default:
      return 'bg-blue-100 text-blue-700'
  }
}

function formatMYR(value: unknown): string {
  const num = Number(value)
  if (!value || Number.isNaN(num)) return '—'
  return `MYR ${num.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function formatDate(value: unknown): string {
  if (!value) return '—'
  const d = new Date(String(value))
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const containerVariants = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.05 } } }
const itemVariants = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }

export default function NoticeDetailPage() {
  const params = useParams<{ noticeId: string }>()
  const noticeId = params.noticeId

  const [status, setStatus] = useState<NoticeStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(
    async (silent?: boolean) => {
      if (!silent) setIsLoading(true)
      try {
        const res = await apiClient.get<NoticeStatus>(`/api/notices/${noticeId}/status`)
        setStatus(res)
        setError(null)
      } catch (err) {
        console.error('[Notice Detail] failed to load', err)
        setError(err instanceof Error ? err.message : 'Failed to load this notice')
      } finally {
        if (!silent) setIsLoading(false)
      }
    },
    [noticeId]
  )

  useEffect(() => {
    load()
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [load])

  // Keep polling only while the case is still in flight, so landing on this
  // page early (e.g. right after submitting) still shows live progress.
  useEffect(() => {
    if (!status) return
    if (TERMINAL_STAGES.includes(status.stage)) {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
      return
    }
    pollRef.current = setInterval(() => load(true), 4000)
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [status?.stage, load])

  const path = status ? pathForStatus(status) : []
  const currentIdx = status ? path.indexOf(status.stage) : -1

  const supplierId = (status?.disruption_notice?.supplier_id as string) || null
  const itemNumber = (status?.disruption_notice?.item_number as string) || null
  const noticeType = (status?.disruption_notice?.notice_type as string) || null
  const messageBody = (status?.disruption_notice?.message_body as string) || null
  const receivedAt = status?.disruption_notice?.received_at || null
  const severity =
    (status?.workbench_item?.severity as string) ||
    (status?.incident?.severity as string) ||
    (status?.run_context?.severity as string) ||
    null
  const humanDecision = (status?.workbench_item?.human_decision as string) || null
  const decidedBy = (status?.workbench_item?.decided_by as string) || null
  const humanNotes = (status?.workbench_item?.human_notes as string) || null
  const decidedAt = (status?.workbench_item?.decided_at as string) || null

  return (
    <motion.div className="max-w-3xl space-y-6" variants={containerVariants} initial="hidden" animate="visible">
      <motion.div variants={itemVariants}>
        <Link
          href="/new-disruption"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-cornflower hover:underline"
        >
          <Icons.arrowLeft className="h-4 w-4" />
          Back to New Disruption
        </Link>
      </motion.div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Icons.loader className="h-8 w-8 animate-spin text-brand-cornflower" />
        </div>
      ) : error || !status ? (
        <Card className="relative overflow-hidden">
          <CardWatermark opacity={3} scale={1} />
          <CardContent className="relative z-10 flex flex-col items-center justify-center py-16 text-center">
            <Icons.alertCircle className="mb-3 h-8 w-8 text-red-500" />
            <h3 className="font-display text-lg font-semibold text-brand-navy">Notice not found</h3>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">{error || `No record for ${noticeId}.`}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <motion.div variants={itemVariants}>
            <h1 className="font-mono text-2xl font-bold text-brand-navy">{status.notice_id}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {supplierId ? `Supplier ${supplierId}` : 'Unknown supplier'}
              {itemNumber ? ` · ${itemNumber}` : ''} · Submitted {formatDate(receivedAt)}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {severity && (
                <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase', severityBadgeClass(severity))}>
                  {severity}
                </span>
              )}
              {noticeType && (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium uppercase text-gray-600">
                  {noticeType.replace(/_/g, ' ')}
                </span>
              )}
            </div>
          </motion.div>

          {messageBody && (
            <motion.div variants={itemVariants}>
              <Card className="relative overflow-hidden">
                <CardWatermark opacity={2} scale={1} />
                <CardContent className="relative z-10 py-5">
                  <p className="mb-2 text-xs font-semibold uppercase text-brand-muted">Original Notice Message</p>
                  <p className="whitespace-pre-wrap text-sm text-foreground">{messageBody}</p>
                </CardContent>
              </Card>
            </motion.div>
          )}

          <motion.div variants={itemVariants}>
            <Card className="relative overflow-hidden">
              <CardWatermark opacity={2} scale={1} />
              <CardContent className="relative z-10 space-y-5 py-5">
                <p className="text-xs font-semibold uppercase text-brand-muted">Pipeline Progress</p>
                <div className="space-y-2">
                  {path.map((key, idx) => {
                    const done = idx < currentIdx
                    const active = key === status.stage
                    const finished = active && TERMINAL_STAGES.includes(key)
                    return (
                      <div key={key} className="flex items-center gap-3">
                        <div
                          className={cn(
                            'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full',
                            done || finished
                              ? 'bg-emerald-500 text-white'
                              : active
                                ? 'bg-brand-cornflower text-white'
                                : 'bg-gray-100 text-gray-400'
                          )}
                        >
                          {done || finished ? (
                            <Icons.check className="h-3.5 w-3.5" />
                          ) : active ? (
                            <Icons.loader className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <div className="h-2 w-2 rounded-full bg-current" />
                          )}
                        </div>
                        <span className={cn('text-sm', active ? 'font-semibold text-brand-navy' : 'text-muted-foreground')}>
                          {STAGE_LABELS[key]}
                        </span>
                      </div>
                    )
                  })}
                </div>

                {status.run_context && (
                  <div className="rounded-lg bg-gray-50 p-3 text-sm">
                    <p className="mb-1 font-medium text-foreground">Impact assessed</p>
                    <p className="text-muted-foreground">
                      Value at risk: {formatMYR(status.run_context.value_at_risk_myr)} · Recommended:{' '}
                      {String(status.run_context.draft_recommended_option || '—')}
                    </p>
                  </div>
                )}

                {status.workbench_item && status.stage !== 'resolved' && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                    <p className="mb-1 font-medium text-amber-900">Routed to Workbench</p>
                    <p className="text-amber-700">{String(status.workbench_item.reason || 'Needs human review.')}</p>
                    <Link href="/workbench" className="mt-2 inline-block text-sm font-medium text-brand-navy underline">
                      Review in Workbench →
                    </Link>
                  </div>
                )}

                {status.incident && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
                    <p className="mb-1 font-medium text-emerald-900">Outcome logged</p>
                    <p className="text-emerald-700">
                      Action: {String(status.incident.action_taken || '—')} · Cost avoided:{' '}
                      {formatMYR(status.incident.cost_avoided_myr)}
                    </p>
                  </div>
                )}

                {humanDecision && (
                  <div className="rounded-lg bg-gray-50 p-3">
                    <p className="text-sm font-medium text-foreground">
                      Decision:{' '}
                      <span
                        className={cn(
                          'font-semibold capitalize',
                          isRejectDecision(humanDecision) ? 'text-red-700' : 'text-emerald-700'
                        )}
                      >
                        {humanDecision}
                      </span>
                      {decidedBy ? ` by ${decidedBy}` : ''}
                    </p>
                    {humanNotes && <p className="mt-1 text-sm text-muted-foreground line-clamp-4">&quot;{humanNotes}&quot;</p>}
                    {decidedAt && <p className="mt-1 text-xs text-muted-foreground">{new Date(decidedAt).toLocaleString()}</p>}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </>
      )}
    </motion.div>
  )
}
