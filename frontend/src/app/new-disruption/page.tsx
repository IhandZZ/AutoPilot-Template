'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { apiClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { CardWatermark } from '@/components/ui/card-watermark'
import { Icons } from '@/components/ui/icons'

interface NoticeStatus {
  notice_id: string
  disruption_notice: Record<string, unknown> | null
  run_context: Record<string, unknown> | null
  incident: Record<string, unknown> | null
  workbench_item: Record<string, unknown> | null
  stage: 'submitted' | 'processing' | 'awaiting_human' | 'resolved' | 'escalated' | 'auto_resolved'
}

const NOTICE_TYPES = ['delay', 'shortage', 'quality', 'price_increase', 'cancellation', 'other']

const STAGE_LABELS: Record<NoticeStatus['stage'], string> = {
  submitted: 'Submitted',
  processing: 'Processing (Auto)',
  awaiting_human: 'Awaiting Human',
  auto_resolved: 'Auto-Resolved',
  escalated: 'Escalated',
  resolved: 'Resolved',
}

// The workflow branches — it either goes to a human (Workbench) or resolves
// on its own, never both. Render only the path that actually happened
// instead of a single fixed line, so we don't show a stage as "done" when
// it was simply skipped.
function pathForStatus(status: NoticeStatus): NoticeStatus['stage'][] {
  const wentToHuman = !!status.workbench_item
  if (wentToHuman) {
    return ['submitted', 'processing', 'awaiting_human', 'resolved']
  }
  if (status.stage === 'escalated') {
    return ['submitted', 'processing', 'escalated']
  }
  return ['submitted', 'processing', 'auto_resolved']
}

const TERMINAL_STAGES: NoticeStatus['stage'][] = ['resolved', 'auto_resolved', 'escalated']

// ============================================================================
// Recent Submissions — outcome categorization
// ============================================================================

type OutcomeCategory = 'good' | 'bad' | 'pending'

// Matches by prefix: this Command Center's own decide endpoint writes
// "reject"/"approve"/"modify", but Auto's separate Slack-based Commander
// Approval flow writes straight to Supabase using its own past-tense
// vocabulary ("rejected"/"approved") — both need to be recognized here.
function isRejectDecision(value: string | null): boolean {
  return (value || '').toLowerCase().startsWith('reject')
}

function outcomeCategory(n: NoticeStatus): OutcomeCategory {
  const humanDecision = (n.workbench_item?.human_decision as string | null) || null
  const approvalStatus = (n.incident?.approval_status as string | null) || null

  if (isRejectDecision(humanDecision) || isRejectDecision(approvalStatus)) return 'bad'
  if (n.stage === 'escalated') return 'bad'
  if (n.stage === 'resolved' || n.stage === 'auto_resolved') return 'good'
  return 'pending' // submitted, processing, awaiting_human
}

// STAGE_LABELS describes the *workflow phase* ("resolved" = a human decision
// closed it out), which is accurate but reads oddly next to a red "reject"
// badge — a rejected case is still technically "resolved" in the pipeline
// sense, but a user glancing at a red badge that says RESOLVED reasonably
// reads that as a contradiction. This gives the badge text specifically
// (not the stage tracker elsewhere) a label that matches what actually
// happened to the AI's recommendation.
function outcomeLabel(n: NoticeStatus): string {
  const humanDecision = (n.workbench_item?.human_decision as string | null) || null
  const approvalStatus = (n.incident?.approval_status as string | null) || null
  if (isRejectDecision(humanDecision) || isRejectDecision(approvalStatus)) return 'Rejected'
  if ((humanDecision || '').toLowerCase().startsWith('modif')) return 'Modified'
  return STAGE_LABELS[n.stage]
}

const OUTCOME_STYLES: Record<OutcomeCategory, { border: string; bg: string; badgeBg: string; badgeText: string; dot: string }> = {
  good: { border: 'border-l-emerald-500', bg: 'bg-emerald-50/40', badgeBg: 'bg-emerald-600', badgeText: 'text-white', dot: 'bg-emerald-500' },
  bad: { border: 'border-l-red-500', bg: 'bg-red-50/40', badgeBg: 'bg-red-600', badgeText: 'text-white', dot: 'bg-red-500' },
  pending: { border: 'border-l-blue-500', bg: 'bg-blue-50/40', badgeBg: 'bg-blue-600', badgeText: 'text-white', dot: 'bg-blue-500' },
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

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
}
const itemVariants = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }

// ============================================================================
// Batch submission types
// ============================================================================

interface BatchCase {
  key: string
  supplierId: string
  itemNumber: string
  noticeType: string
  severity: string
  messageBody: string
  submitStatus: 'idle' | 'submitting' | 'success' | 'error'
  noticeId?: string
  errorMessage?: string
}

function emptyBatchCase(): BatchCase {
  return {
    key: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `case-${Date.now()}-${Math.random()}`,
    supplierId: '',
    itemNumber: '',
    noticeType: 'delay',
    severity: '',
    messageBody: '',
    submitStatus: 'idle',
  }
}

export default function NewDisruptionPage() {
  const [mode, setMode] = useState<'single' | 'batch'>('single')

  const [supplierId, setSupplierId] = useState('')
  const [itemNumber, setItemNumber] = useState('')
  const [noticeType, setNoticeType] = useState('delay')
  const [severity, setSeverity] = useState('')
  const [messageBody, setMessageBody] = useState('')

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [status, setStatus] = useState<NoticeStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recentNotices, setRecentNotices] = useState<NoticeStatus[]>([])
  const [isLoadingRecent, setIsLoadingRecent] = useState(true)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Batch mode state — a list of cases submitted one after another.
  const [batchCases, setBatchCases] = useState<BatchCase[]>([emptyBatchCase()])
  const [isBatchSubmitting, setIsBatchSubmitting] = useState(false)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => stopPolling, [stopPolling])

  const loadRecent = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setIsLoadingRecent(true)
    try {
      // Fetch the last 10 — "Recent Submissions" shows the first 3 of this
      // list, "Submission History" shows all 10, so one fetch covers both.
      const res = await apiClient.get<NoticeStatus[]>('/api/notices?limit=10')
      setRecentNotices(res)
    } catch (err) {
      console.error('[New Disruption] failed to load recent notices', err)
    } finally {
      if (!opts?.silent) setIsLoadingRecent(false)
    }
  }, [])

  // Initial load, then keep it fresh in the background so it reflects new
  // submissions (from this tab or elsewhere) without the user having to
  // click Refresh — silent so it doesn't flicker the loading spinner every
  // few seconds.
  useEffect(() => {
    loadRecent()
    const interval = setInterval(() => loadRecent({ silent: true }), 8000)
    return () => clearInterval(interval)
  }, [loadRecent])

  const pollStatus = useCallback((noticeId: string) => {
    stopPolling()
    pollRef.current = setInterval(async () => {
      try {
        const res = await apiClient.get<NoticeStatus>(`/api/notices/${noticeId}/status`)
        setStatus(res)
        if (['resolved', 'auto_resolved'].includes(res.stage)) {
          stopPolling()
          loadRecent()
        }
      } catch (err) {
        console.error('[New Disruption] status poll failed', err)
      }
    }, 4000)
  }, [stopPolling, loadRecent])

  const handleSubmit = async () => {
    if (!messageBody.trim()) return
    setIsSubmitting(true)
    setError(null)
    setStatus(null)
    try {
      const res = await apiClient.post<{ notice_id: string; status: string }>('/api/notices', {
        supplier_id: supplierId || null,
        item_number: itemNumber || null,
        notice_type: noticeType,
        message_body: messageBody,
        severity: severity || null,
        channel: 'manual',
      })
      setStatus({
        notice_id: res.notice_id,
        disruption_notice: null,
        run_context: null,
        incident: null,
        workbench_item: null,
        stage: 'submitted',
      })
      pollStatus(res.notice_id)
      loadRecent()
    } catch (err) {
      console.error('[New Disruption] submit failed', err)
      setError(err instanceof Error ? err.message : 'Failed to submit notice')
    } finally {
      setIsSubmitting(false)
    }
  }

  // ==========================================================================
  // Batch mode handlers
  // ==========================================================================

  const addBatchCase = () => {
    setBatchCases((cases) => [...cases, emptyBatchCase()])
  }

  const removeBatchCase = (key: string) => {
    setBatchCases((cases) => (cases.length > 1 ? cases.filter((c) => c.key !== key) : cases))
  }

  const updateBatchCase = (key: string, field: keyof BatchCase, value: string) => {
    setBatchCases((cases) => cases.map((c) => (c.key === key ? { ...c, [field]: value } : c)))
  }

  const batchReadyCount = batchCases.filter((c) => c.messageBody.trim()).length

  const handleBatchSubmit = async () => {
    setIsBatchSubmitting(true)
    // Submit sequentially so we don't hammer Auto with concurrent triggers,
    // and so progress is visible case-by-case rather than all-at-once.
    for (const c of batchCases) {
      if (!c.messageBody.trim()) continue
      setBatchCases((cases) => cases.map((x) => (x.key === c.key ? { ...x, submitStatus: 'submitting' } : x)))
      try {
        const res = await apiClient.post<{ notice_id: string; status: string }>('/api/notices', {
          supplier_id: c.supplierId || null,
          item_number: c.itemNumber || null,
          notice_type: c.noticeType,
          message_body: c.messageBody,
          severity: c.severity || null,
          channel: 'manual',
        })
        setBatchCases((cases) =>
          cases.map((x) => (x.key === c.key ? { ...x, submitStatus: 'success', noticeId: res.notice_id } : x))
        )
      } catch (err) {
        setBatchCases((cases) =>
          cases.map((x) =>
            x.key === c.key
              ? { ...x, submitStatus: 'error', errorMessage: err instanceof Error ? err.message : 'Submit failed' }
              : x
          )
        )
      }
    }
    setIsBatchSubmitting(false)
    loadRecent()
  }

  const resetBatch = () => {
    setBatchCases([emptyBatchCase()])
  }

  // Shared card renderer — used by both "Recent Submissions" (last 3) and
  // "Submission History" (last 10) so they stay visually identical.
  const renderNoticeCard = (n: NoticeStatus) => {
    const category = outcomeCategory(n)
    const style = OUTCOME_STYLES[category]
    const isSelected = status?.notice_id === n.notice_id
    const supplierId = (n.disruption_notice?.supplier_id as string) || null
    const itemNumber = (n.disruption_notice?.item_number as string) || null
    const noticeType = (n.disruption_notice?.notice_type as string) || null
    const receivedAt = n.disruption_notice?.received_at || null
    const severity =
      (n.workbench_item?.severity as string) ||
      (n.incident?.severity as string) ||
      (n.run_context?.severity as string) ||
      null
    const valueAtRisk =
      n.workbench_item?.value_at_risk_myr ?? n.incident?.value_at_risk_myr ?? n.run_context?.value_at_risk_myr ?? null
    const recommendedOption =
      (n.workbench_item?.recommended_option as string) ||
      (n.incident?.recommended_option as string) ||
      (n.run_context?.draft_recommended_option as string) ||
      null
    const humanDecision = (n.workbench_item?.human_decision as string) || null
    const decidedBy = (n.workbench_item?.decided_by as string) || null
    const costAvoided = n.incident?.cost_avoided_myr ?? null

    return (
      // A real page navigation (not an in-place panel swap on this same
      // page) — each notice gets its own shareable/bookmarkable URL under
      // /new-disruption/[noticeId], so reviewing a past case is an
      // auditable trail rather than transient client-side state.
      <Link
        key={n.notice_id}
        href={`/new-disruption/${n.notice_id}`}
        className={cn(
          'block w-full text-left rounded-lg border-l-4 p-4 transition-all',
          style.border,
          style.bg,
          isSelected ? 'ring-2 ring-brand-cornflower/50' : 'hover:shadow-md'
        )}
      >
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className={cn('h-2 w-2 rounded-full flex-shrink-0', style.dot)} />
            <span className="font-mono text-sm font-bold text-foreground">{n.notice_id}</span>
            {severity && (
              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase bg-gray-800 text-white">
                {severity}
              </span>
            )}
            {noticeType && (
              <span className="rounded-full px-2 py-0.5 text-[10px] font-medium uppercase bg-gray-100 text-gray-600">
                {noticeType.replace(/_/g, ' ')}
              </span>
            )}
          </div>
          <span className={cn('rounded-full px-3 py-1 text-xs font-bold uppercase flex-shrink-0', style.badgeBg, style.badgeText)}>
            {outcomeLabel(n)}
          </span>
        </div>

        {/* Supplier / item / date */}
        <p className="mt-2 text-sm text-foreground font-medium">
          {supplierId ? `Supplier ${supplierId}` : 'Unknown supplier'}
          {itemNumber ? ` · ${itemNumber}` : ''}
        </p>
        <p className="text-xs text-muted-foreground">{formatDate(receivedAt)}</p>

        {/* Detail grid */}
        {(valueAtRisk || recommendedOption || costAvoided) && (
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
            {valueAtRisk != null && (
              <div className="rounded-md bg-white/70 px-2.5 py-1.5">
                <p className="text-[10px] uppercase text-muted-foreground">Value at Risk</p>
                <p className="text-sm font-semibold text-foreground">{formatMYR(valueAtRisk)}</p>
              </div>
            )}
            {costAvoided != null && (
              <div className="rounded-md bg-white/70 px-2.5 py-1.5">
                <p className="text-[10px] uppercase text-muted-foreground">Cost Avoided</p>
                <p className="text-sm font-semibold text-emerald-700">{formatMYR(costAvoided)}</p>
              </div>
            )}
            {recommendedOption && (
              <div className="rounded-md bg-white/70 px-2.5 py-1.5 col-span-2 sm:col-span-1">
                <p className="text-[10px] uppercase text-muted-foreground">Recommended</p>
                <p className="text-sm font-semibold text-foreground truncate">{recommendedOption}</p>
              </div>
            )}
          </div>
        )}

        {/* Human decision footer */}
        {humanDecision && (
          <p className="mt-2 text-xs text-muted-foreground">
            Decision: <span className="font-semibold capitalize text-foreground">{humanDecision}</span>
            {decidedBy ? ` by ${decidedBy}` : ''}
          </p>
        )}
      </Link>
    )
  }

  const path = status ? pathForStatus(status) : []
  const currentIdx = status ? path.indexOf(status.stage) : -1

  return (
    <motion.div className="space-y-6" variants={containerVariants} initial="hidden" animate="visible">
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-display-3 font-bold tracking-tight text-brand-navy lg:text-display-2">
            New Disruption Notice
          </h1>
          <p className="mt-1 text-lg text-muted-foreground">
            Submit an unseen supplier disruption notice — this inserts it into Supabase and triggers the real
            Supervity Auto Orchestrator (Intake → Impact/Recovery → Execute) against it, live.
          </p>
        </div>
        <div className="flex gap-1 p-1.5 bg-gray-100 rounded-xl w-fit flex-shrink-0">
          {(['single', 'batch'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-medium transition-colors capitalize',
                mode === m ? 'bg-white text-brand-navy shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {m === 'single' ? 'Single Case' : 'Multiple Cases'}
            </button>
          ))}
        </div>
      </motion.div>

      {mode === 'single' ? (
      <motion.div variants={itemVariants} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Form */}
        <Card className="relative overflow-hidden">
          <CardWatermark opacity={2} scale={1} />
          <CardContent className="relative z-10 space-y-4 py-6">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Supplier ID</label>
              <input
                type="text"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                placeholder="e.g. SUP-0042 (leave blank if unknown)"
                className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-cornflower/50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Item Number</label>
              <input
                type="text"
                value={itemNumber}
                onChange={(e) => setItemNumber(e.target.value)}
                placeholder="e.g. ITEM-1001"
                className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-cornflower/50"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Notice Type</label>
                <select
                  value={noticeType}
                  onChange={(e) => setNoticeType(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-cornflower/50"
                >
                  {NOTICE_TYPES.map((t) => (
                    <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Severity (optional)</label>
                <select
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-cornflower/50"
                >
                  <option value="">Let AI decide</option>
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Notice Message</label>
              <textarea
                value={messageBody}
                onChange={(e) => setMessageBody(e.target.value)}
                rows={6}
                placeholder="Paste or write the raw disruption notice text — e.g. a supplier email saying a shipment will be delayed 3 weeks..."
                className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-cornflower/50"
              />
            </div>
            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}
            <Button
              variant="gradient"
              className="w-full"
              disabled={isSubmitting || !messageBody.trim()}
              onClick={handleSubmit}
            >
              {isSubmitting ? (
                <><Icons.loader className="mr-2 h-4 w-4 animate-spin" />Submitting...</>
              ) : (
                <><Icons.zap className="mr-2 h-4 w-4" />Submit &amp; Trigger Auto</>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Live Status */}
        <Card className="relative overflow-hidden">
          <CardWatermark opacity={2} scale={1} />
          <CardContent className="relative z-10 py-6">
            {!status ? (
              <div className="flex flex-col items-center justify-center h-full py-16 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-cornflower/20 to-brand-purple/20">
                  <Icons.bot className="h-8 w-8 text-brand-cornflower" strokeWidth={1.5} />
                </div>
                <h3 className="font-display text-lg font-semibold text-brand-navy">Waiting for a notice</h3>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  Submit the form to see the Orchestrator run against it live.
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                <div>
                  <p className="text-xs text-muted-foreground">Notice ID</p>
                  <p className="font-mono text-sm font-semibold text-brand-navy">{status.notice_id}</p>
                </div>

                {/* Stage timeline — only the branch that actually happened */}
                <div className="space-y-2">
                  {path.map((key, idx) => {
                      const done = idx < currentIdx
                      const active = key === status.stage
                      const finished = active && TERMINAL_STAGES.includes(key)
                      return (
                        <div key={key} className="flex items-center gap-3">
                          <div
                            className={cn(
                              'h-6 w-6 rounded-full flex items-center justify-center flex-shrink-0',
                              done || finished ? 'bg-emerald-500 text-white' : active ? 'bg-brand-cornflower text-white' : 'bg-gray-100 text-gray-400'
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
                    <p className="font-medium text-foreground mb-1">Impact assessed</p>
                    <p className="text-muted-foreground">
                      Value at risk: MYR {Number(status.run_context.value_at_risk_myr || 0).toLocaleString()} ·{' '}
                      Recommended: {String(status.run_context.draft_recommended_option || '—')}
                    </p>
                  </div>
                )}

                {status.workbench_item && status.stage !== 'resolved' && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                    <p className="font-medium text-amber-900 mb-1">Routed to Workbench</p>
                    <p className="text-amber-700">{String(status.workbench_item.reason || 'Needs human review.')}</p>
                    <Link href="/workbench" className="inline-block mt-2 text-sm font-medium text-brand-navy underline">
                      Review in Workbench →
                    </Link>
                  </div>
                )}

                {status.incident && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
                    <p className="font-medium text-emerald-900 mb-1">Outcome logged</p>
                    <p className="text-emerald-700">
                      Action: {String(status.incident.action_taken || '—')} · Cost avoided: MYR{' '}
                      {Number(status.incident.cost_avoided_myr || 0).toLocaleString()}
                    </p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
      ) : (
      /* Batch mode — submit several disruption notices in one go. */
      <motion.div variants={itemVariants} className="space-y-4">
        <Card className="relative overflow-hidden">
          <CardWatermark opacity={2} scale={1} />
          <CardContent className="relative z-10 py-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display text-lg font-semibold text-brand-navy">Batch Cases</h3>
                <p className="text-sm text-muted-foreground">
                  Add as many disruption notices as you want, then submit them all — each triggers its own Auto run.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={resetBatch} disabled={isBatchSubmitting}>
                <Icons.close className="mr-2 h-3.5 w-3.5" />
                Clear All
              </Button>
            </div>

            <div className="space-y-4">
              {batchCases.map((c, idx) => {
                const statusBadge =
                  c.submitStatus === 'success' ? (
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase bg-emerald-100 text-emerald-700 flex items-center gap-1">
                      <Icons.check className="h-3 w-3" /> Submitted
                    </span>
                  ) : c.submitStatus === 'error' ? (
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase bg-red-100 text-red-700">
                      Failed
                    </span>
                  ) : c.submitStatus === 'submitting' ? (
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase bg-blue-100 text-blue-700 flex items-center gap-1">
                      <Icons.loader className="h-3 w-3 animate-spin" /> Submitting
                    </span>
                  ) : null

                return (
                  <div key={c.key} className="rounded-xl border border-gray-200 p-4 space-y-3 relative">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-brand-navy">Case {idx + 1}</span>
                      <div className="flex items-center gap-2">
                        {statusBadge}
                        {batchCases.length > 1 && c.submitStatus === 'idle' && (
                          <button
                            onClick={() => removeBatchCase(c.key)}
                            className="text-muted-foreground hover:text-red-600"
                            aria-label="Remove case"
                          >
                            <Icons.close className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">Supplier ID</label>
                        <input
                          type="text"
                          value={c.supplierId}
                          onChange={(e) => updateBatchCase(c.key, 'supplierId', e.target.value)}
                          placeholder="e.g. 3056 (optional)"
                          disabled={c.submitStatus !== 'idle'}
                          className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-cornflower/50 disabled:opacity-60"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">Item Number</label>
                        <input
                          type="text"
                          value={c.itemNumber}
                          onChange={(e) => updateBatchCase(c.key, 'itemNumber', e.target.value)}
                          placeholder="e.g. SKU-RM-330 (optional)"
                          disabled={c.submitStatus !== 'idle'}
                          className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-cornflower/50 disabled:opacity-60"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">Notice Type</label>
                        <select
                          value={c.noticeType}
                          onChange={(e) => updateBatchCase(c.key, 'noticeType', e.target.value)}
                          disabled={c.submitStatus !== 'idle'}
                          className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-cornflower/50 disabled:opacity-60"
                        >
                          {NOTICE_TYPES.map((t) => (
                            <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">Severity</label>
                        <select
                          value={c.severity}
                          onChange={(e) => updateBatchCase(c.key, 'severity', e.target.value)}
                          disabled={c.submitStatus !== 'idle'}
                          className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-cornflower/50 disabled:opacity-60"
                        >
                          <option value="">Let AI decide</option>
                          <option value="LOW">Low</option>
                          <option value="MEDIUM">Medium</option>
                          <option value="HIGH">High</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1">Notice Message</label>
                      <textarea
                        value={c.messageBody}
                        onChange={(e) => updateBatchCase(c.key, 'messageBody', e.target.value)}
                        rows={3}
                        placeholder="Paste or write the raw disruption notice text — required to submit this case..."
                        disabled={c.submitStatus !== 'idle'}
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-cornflower/50 disabled:opacity-60"
                      />
                    </div>

                    {c.submitStatus === 'success' && c.noticeId && (
                      <p className="text-xs text-emerald-700">
                        Notice <span className="font-mono font-semibold">{c.noticeId}</span> submitted — see it in Recent Submissions below.
                      </p>
                    )}
                    {c.submitStatus === 'error' && c.errorMessage && (
                      <p className="text-xs text-red-600">{c.errorMessage}</p>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button variant="outline" onClick={addBatchCase} disabled={isBatchSubmitting}>
                <Icons.zap className="mr-2 h-4 w-4" />
                Add Another Case
              </Button>
              <Button
                variant="gradient"
                className="flex-1 min-w-[200px]"
                disabled={isBatchSubmitting || batchReadyCount === 0}
                onClick={handleBatchSubmit}
              >
                {isBatchSubmitting ? (
                  <><Icons.loader className="mr-2 h-4 w-4 animate-spin" />Submitting cases...</>
                ) : (
                  <><Icons.zap className="mr-2 h-4 w-4" />Submit All ({batchReadyCount} case{batchReadyCount === 1 ? '' : 's'})</>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
      )}

      {/* Recent Submissions — the last 3, for a quick glance after submitting. */}
      <motion.div variants={itemVariants}>
        <Card className="relative overflow-hidden">
          <CardWatermark opacity={2} scale={1} />
          <CardContent className="relative z-10 py-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-lg font-semibold text-brand-navy">Recent Submissions</h3>
              <Button variant="outline" size="sm" onClick={loadRecent} disabled={isLoadingRecent}>
                <Icons.loader className={cn('mr-2 h-3.5 w-3.5', isLoadingRecent && 'animate-spin')} />
                Refresh
              </Button>
            </div>
            {recentNotices.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Nothing submitted through this page yet.
              </p>
            ) : (
              <div className="space-y-3">
                {recentNotices.slice(0, 3).map(renderNoticeCard)}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Submission History — the last 10, for a fuller audit trail. */}
      <motion.div variants={itemVariants}>
        <Card className="relative overflow-hidden">
          <CardWatermark opacity={2} scale={1} />
          <CardContent className="relative z-10 py-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-display text-lg font-semibold text-brand-navy">Submission History</h3>
                <p className="text-xs text-muted-foreground">Last {Math.min(recentNotices.length, 10)} notices submitted through this page.</p>
              </div>
              <Button variant="outline" size="sm" onClick={loadRecent} disabled={isLoadingRecent}>
                <Icons.loader className={cn('mr-2 h-3.5 w-3.5', isLoadingRecent && 'animate-spin')} />
                Refresh
              </Button>
            </div>
            {recentNotices.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Nothing submitted through this page yet.
              </p>
            ) : (
              <div className="space-y-3">
                {recentNotices.slice(0, 10).map(renderNoticeCard)}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  )
}
