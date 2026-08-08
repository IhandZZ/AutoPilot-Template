'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import { apiClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { CardWatermark } from '@/components/ui/card-watermark'
import { Icons } from '@/components/ui/icons'

// ============================================================================
// Types — mirrors app/schemas/workbench.py
// ============================================================================

interface WorkbenchItemSummary {
  id: number
  notice_id: string | null
  item_number: string | null
  supplier_id: string | null
  supplier_name: string | null
  severity: string | null
  value_at_risk_myr: number | null
  recommended_option: string | null
  reason: string | null
  status: string | null
  human_decision: string | null
  decided_by: string | null
  decided_at: string | null
  created_at: string | null
}

interface DraftCommunication {
  to: string
  subject: string
  body: string
}

interface WorkbenchItemDetail extends WorkbenchItemSummary {
  context_json: Record<string, unknown> | null
  human_notes: string | null
  run_context: Record<string, unknown> | null
  incident: Record<string, unknown> | null
  draft_communication: DraftCommunication | null
}

type DecisionType = 'approve' | 'reject' | 'modify'

// ============================================================================
// Helpers
// ============================================================================

function severityConfig(severity: string | null) {
  switch ((severity || '').toLowerCase()) {
    case 'critical':
      return { bg: 'bg-red-50', border: 'border-red-200', badge: 'bg-red-100 text-red-700', icon: Icons.alertCircle, iconColor: 'text-red-600' }
    case 'high':
      return { bg: 'bg-red-50/70', border: 'border-red-200', badge: 'bg-red-100 text-red-600', icon: Icons.alertCircle, iconColor: 'text-red-500' }
    case 'warning':
    case 'medium':
      return { bg: 'bg-amber-50', border: 'border-amber-200', badge: 'bg-amber-100 text-amber-700', icon: Icons.alertTriangle, iconColor: 'text-amber-600' }
    default:
      return { bg: 'bg-blue-50', border: 'border-blue-200', badge: 'bg-blue-100 text-blue-700', icon: Icons.info, iconColor: 'text-blue-600' }
  }
}

// Matches by prefix, not exact value: this Command Center's own /decide
// endpoint writes "approve"/"reject"/"modify", but Auto's separate
// Slack-based Commander Approval flow writes straight to Supabase using its
// own past-tense vocabulary ("approved"/"rejected") — both are real
// decisions and both should color correctly regardless of which path wrote
// them.
function decisionKind(decision: string | null): 'approve' | 'reject' | 'modify' | null {
  const d = (decision || '').toLowerCase()
  if (d.startsWith('approv')) return 'approve'
  if (d.startsWith('reject')) return 'reject'
  if (d.startsWith('modif')) return 'modify'
  return null
}

// Card container styling: for a resolved item, the decision (what actually
// happened) is more useful to scan at a glance than severity (which — as
// noted when every queued case turned out HIGH — can end up looking
// uniform across the whole list). Pending items have no decision yet, so
// they keep the severity-based coloring.
function cardStyle(item: WorkbenchItemSummary) {
  if (item.status !== 'pending') {
    switch (decisionKind(item.human_decision)) {
      case 'approve':
        return {
          bg: 'bg-emerald-50/70',
          border: 'border-emerald-200',
          badge: 'bg-emerald-100 text-emerald-700',
          icon: Icons.checkCircle,
          iconColor: 'text-emerald-600',
        }
      case 'reject':
        return {
          bg: 'bg-red-50/70',
          border: 'border-red-200',
          badge: 'bg-red-100 text-red-600',
          icon: Icons.close,
          iconColor: 'text-red-600',
        }
      case 'modify':
        return {
          bg: 'bg-blue-50/70',
          border: 'border-blue-200',
          badge: 'bg-blue-100 text-blue-700',
          icon: Icons.edit,
          iconColor: 'text-blue-600',
        }
      default:
        break
    }
  }
  return severityConfig(item.severity)
}

function decisionBadgeStyle(decision: string | null) {
  switch (decisionKind(decision)) {
    case 'approve':
      return 'bg-emerald-100 text-emerald-700'
    case 'reject':
      return 'bg-red-100 text-red-700'
    case 'modify':
      return 'bg-blue-100 text-blue-700'
    default:
      return 'bg-gray-100 text-gray-600'
  }
}

function decisionTextColor(decision: string | null) {
  switch (decisionKind(decision)) {
    case 'approve':
      return 'text-emerald-700'
    case 'reject':
      return 'text-red-700'
    case 'modify':
      return 'text-blue-700'
    default:
      return 'text-foreground'
  }
}

function formatMYR(value: number | null) {
  if (value === null || value === undefined) return '—'
  return `MYR ${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function formatKey(key: string) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
}
const itemVariants = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }

// ============================================================================
// Page
// ============================================================================

export default function WorkbenchPage() {
  const [items, setItems] = useState<WorkbenchItemSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'pending' | 'resolved' | 'all'>('pending')

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detail, setDetail] = useState<WorkbenchItemDetail | null>(null)
  const [isDetailLoading, setIsDetailLoading] = useState(false)

  const [feedback, setFeedback] = useState('')
  const [modifiedOption, setModifiedOption] = useState('')
  const [isSubmitting, setIsSubmitting] = useState<DecisionType | null>(null)
  const [showRawContext, setShowRawContext] = useState(false)
  const [copiedDraft, setCopiedDraft] = useState(false)

  // Stat cards need the TRUE totals regardless of which tab is active — kept
  // as a separate, always-unfiltered fetch so switching to "Resolved" (or
  // any single-status tab) doesn't make "Pending Review" read 0 just
  // because no pending items happen to be in the currently displayed list.
  const [statsItems, setStatsItems] = useState<WorkbenchItemSummary[]>([])

  const loadStats = useCallback(async () => {
    try {
      const data = await apiClient.get<WorkbenchItemSummary[]>('/api/workbench/items?limit=100')
      setStatsItems(data)
    } catch (err) {
      console.error('[Workbench] failed to load stats', err)
    }
  }, [])

  const loadItems = useCallback(async () => {
    setIsLoading(true)
    try {
      const qs = statusFilter === 'all' ? '' : `?status=${statusFilter}`
      const data = await apiClient.get<WorkbenchItemSummary[]>(`/api/workbench/items${qs}`)
      setItems(data)
    } catch (err) {
      console.error('[Workbench] failed to load items', err)
      setItems([])
    } finally {
      setIsLoading(false)
    }
  }, [statusFilter])

  useEffect(() => {
    loadItems()
  }, [loadItems])

  useEffect(() => {
    loadStats()
  }, [loadStats])

  const loadDetail = useCallback(async (id: number) => {
    setIsDetailLoading(true)
    setFeedback('')
    setModifiedOption('')
    setShowRawContext(false)
    try {
      const data = await apiClient.get<WorkbenchItemDetail>(`/api/workbench/items/${id}`)
      setDetail(data)
      setModifiedOption(data.recommended_option || '')
    } catch (err) {
      console.error('[Workbench] failed to load item detail', err)
      setDetail(null)
    } finally {
      setIsDetailLoading(false)
    }
  }, [])

  const handleSelect = (id: number) => {
    setSelectedId(id)
    loadDetail(id)
  }

  const handleDecide = async (decision: DecisionType) => {
    if (!selectedId) return
    setIsSubmitting(decision)
    try {
      await apiClient.post(`/api/workbench/items/${selectedId}/decide`, {
        decision,
        notes: feedback || null,
        decided_by: 'Dev User',
        modified_option: decision === 'modify' ? modifiedOption : null,
      })
      await Promise.all([loadItems(), loadStats()])
      setSelectedId(null)
      setDetail(null)
    } catch (err) {
      console.error('[Workbench] failed to submit decision', err)
    } finally {
      setIsSubmitting(null)
    }
  }

  const pendingCount = statsItems.filter((i) => i.status === 'pending').length
  const resolvedCount = statsItems.filter((i) => i.status === 'resolved').length
  const totalAtRisk = statsItems
    .filter((i) => i.status === 'pending')
    .reduce((sum, i) => sum + (i.value_at_risk_myr || 0), 0)

  return (
    <motion.div className="space-y-6" variants={containerVariants} initial="hidden" animate="visible">
      {/* Header */}
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-display-3 font-bold tracking-tight text-brand-navy lg:text-display-2">
            AI Workbench
          </h1>
          <p className="mt-1 text-lg text-muted-foreground">
            Exceptions the AI Employee couldn&apos;t resolve on its own — reviewed and decided here.
          </p>
        </div>
        <Button variant="outline" onClick={() => { loadItems(); loadStats() }} disabled={isLoading}>
          <Icons.loader className={cn('mr-2 h-4 w-4', isLoading && 'animate-spin')} />
          Refresh
        </Button>
      </motion.div>

      {/* Stats */}
      <motion.div variants={itemVariants} className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {[
          { value: pendingCount, label: 'Pending Review', icon: Icons.alertTriangle, bg: 'bg-amber-100', color: 'text-amber-600' },
          { value: resolvedCount, label: 'Resolved', icon: Icons.check, bg: 'bg-emerald-100', color: 'text-emerald-600' },
          { value: formatMYR(totalAtRisk), label: 'Value at Risk (Pending)', icon: Icons.activity, bg: 'bg-brand-navy/10', color: 'text-brand-navy' },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-3">
              <div className={cn('p-2 rounded-lg', stat.bg)}>
                <stat.icon className={cn('h-5 w-5', stat.color)} />
              </div>
              <div>
                <p className={cn('text-2xl font-bold', stat.color)}>{stat.value}</p>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
              </div>
            </div>
          </div>
        ))}
      </motion.div>

      {/* Filter tabs */}
      <motion.div variants={itemVariants} className="flex gap-1 p-1.5 bg-gray-100 rounded-xl w-fit">
        {(['pending', 'resolved', 'all'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium transition-colors capitalize',
              statusFilter === f ? 'bg-white text-brand-navy shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {f}
          </button>
        ))}
      </motion.div>

      {/* Queue + Detail */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Queue List */}
        <div className="lg:col-span-2 space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Icons.loader className="h-8 w-8 animate-spin text-brand-cornflower" />
            </div>
          ) : items.length === 0 ? (
            <Card className="relative overflow-hidden">
              <CardWatermark opacity={3} scale={1} />
              <CardContent className="relative z-10 flex flex-col items-center justify-center py-16 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-100 to-emerald-50">
                  <Icons.check className="h-8 w-8 text-emerald-600" strokeWidth={1.5} />
                </div>
                <h3 className="font-display text-lg font-semibold text-brand-navy">All clear</h3>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  No {statusFilter === 'all' ? '' : statusFilter} exceptions right now.
                </p>
              </CardContent>
            </Card>
          ) : (
            items.map((item) => {
              const sev = cardStyle(item)
              const SevIcon = sev.icon
              const isSelected = selectedId === item.id
              return (
                <button
                  key={item.id}
                  onClick={() => handleSelect(item.id)}
                  className={cn(
                    'w-full text-left rounded-xl border p-4 transition-all',
                    sev.bg,
                    isSelected ? 'border-brand-cornflower ring-2 ring-brand-cornflower/30' : sev.border,
                    'hover:shadow-md'
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className={cn('flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg', sev.badge)}>
                      <SevIcon className={cn('h-4 w-4', sev.iconColor)} strokeWidth={1.5} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-foreground text-sm">
                          {item.notice_id || `Item #${item.id}`}
                        </span>
                        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase', severityConfig(item.severity).badge)}>
                          {item.severity || 'unknown'}
                        </span>
                        {item.status !== 'pending' && (
                          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase', decisionBadgeStyle(item.human_decision))}>
                            {item.human_decision || item.status}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{item.reason || 'No reason recorded.'}</p>
                      <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{item.supplier_name || item.supplier_id || 'Unknown supplier'}</span>
                        <span>•</span>
                        <span className="font-medium text-foreground">{formatMYR(item.value_at_risk_myr)}</span>
                      </div>
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </div>

        {/* Detail Panel */}
        <div className="lg:col-span-3">
          <AnimatePresence mode="wait">
            {!selectedId ? (
              <Card className="relative overflow-hidden h-full">
                <CardWatermark opacity={2} scale={1} />
                <CardContent className="relative z-10 flex flex-col items-center justify-center py-24 text-center h-full">
                  <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-cornflower/20 to-brand-purple/20">
                    <Icons.brain className="h-8 w-8 text-brand-cornflower" strokeWidth={1.5} />
                  </div>
                  <h3 className="font-display text-lg font-semibold text-brand-navy">Select an exception</h3>
                  <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                    Pick an item from the queue to see the AI&apos;s full reasoning and decide.
                  </p>
                </CardContent>
              </Card>
            ) : isDetailLoading || !detail ? (
              <div className="flex items-center justify-center py-24">
                <Icons.loader className="h-8 w-8 animate-spin text-brand-cornflower" />
              </div>
            ) : (
              <motion.div
                key={detail.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.15 }}
              >
                <Card className="relative overflow-hidden">
                  <CardWatermark opacity={2} scale={1} />
                  <CardContent className="relative z-10 space-y-5 py-6">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="font-display text-xl font-semibold text-brand-navy">
                          {detail.notice_id || `Item #${detail.id}`}
                        </h3>
                        <p className="text-sm text-muted-foreground mt-1">
                          {detail.supplier_name || detail.supplier_id} · {detail.item_number || 'no item ref'}
                        </p>
                      </div>
                      <span className={cn('rounded-full px-3 py-1 text-xs font-semibold uppercase', severityConfig(detail.severity).badge)}>
                        {detail.severity || 'unknown'}
                      </span>
                    </div>

                    {/* Key metrics */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg bg-gray-50 p-3">
                        <p className="text-xs text-muted-foreground">Value at Risk</p>
                        <p className="text-lg font-bold text-brand-navy">{formatMYR(detail.value_at_risk_myr)}</p>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-3">
                        <p className="text-xs text-muted-foreground">Status</p>
                        <p className="text-lg font-bold text-brand-navy capitalize">{detail.status}</p>
                      </div>
                    </div>

                    {/* AI Recommendation */}
                    <div className="rounded-lg border border-brand-cornflower/30 bg-brand-cornflower/5 p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Icons.sparkles className="h-4 w-4 text-brand-cornflower" strokeWidth={1.5} />
                        <span className="text-sm font-semibold text-brand-navy">AI Recommendation</span>
                      </div>
                      <p className="text-sm font-medium text-foreground">{detail.recommended_option || 'No recommendation recorded.'}</p>
                      {detail.reason && <p className="mt-2 text-sm text-muted-foreground">{detail.reason}</p>}
                    </div>

                    {/* Context chips */}
                    {detail.run_context && (
                      <div>
                        <button
                          onClick={() => setShowRawContext((v) => !v)}
                          className="flex items-center gap-1.5 text-sm font-medium text-brand-navy"
                        >
                          <Icons.layers className="h-4 w-4" />
                          Full agent context
                          <Icons.chevronDown className={cn('h-4 w-4 transition-transform', showRawContext && 'rotate-180')} />
                        </button>
                        {showRawContext && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {Object.entries({ ...detail.run_context, ...(detail.context_json || {}) })
                              .filter(([, v]) => v !== null && v !== undefined && v !== '')
                              .map(([key, value]) => (
                                <span
                                  key={key}
                                  className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-foreground"
                                >
                                  <span className="text-muted-foreground">{formatKey(key)}:</span>
                                  <span className="font-semibold">{String(value)}</span>
                                </span>
                              ))}
                          </div>
                        )}
                      </div>
                    )}

                    {detail.status === 'pending' ? (
                      <>
                        {/* Modify option input (shown contextually) */}
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-1.5">
                            Feedback / notes
                          </label>
                          <textarea
                            value={feedback}
                            onChange={(e) => setFeedback(e.target.value)}
                            placeholder="Why are you approving, rejecting, or changing this?"
                            rows={3}
                            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-cornflower/50"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-foreground mb-1.5">
                            Modified action (used only if you choose &quot;Modify&quot;)
                          </label>
                          <input
                            type="text"
                            value={modifiedOption}
                            onChange={(e) => setModifiedOption(e.target.value)}
                            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-cornflower/50"
                          />
                        </div>

                        {/* Actions */}
                        <div className="flex flex-wrap gap-3 pt-2">
                          <Button
                            variant="default"
                            className="bg-emerald-600 hover:bg-emerald-700"
                            disabled={isSubmitting !== null}
                            onClick={() => handleDecide('approve')}
                          >
                            {isSubmitting === 'approve' ? (
                              <Icons.loader className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Icons.check className="mr-2 h-4 w-4" />
                            )}
                            Approve
                          </Button>
                          <Button
                            variant="outline"
                            disabled={isSubmitting !== null}
                            onClick={() => handleDecide('modify')}
                          >
                            {isSubmitting === 'modify' ? (
                              <Icons.loader className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Icons.grid className="mr-2 h-4 w-4" />
                            )}
                            Modify &amp; Approve
                          </Button>
                          <Button
                            variant="ghost"
                            className="text-red-600 hover:bg-red-50 hover:text-red-700"
                            disabled={isSubmitting !== null}
                            onClick={() => handleDecide('reject')}
                          >
                            {isSubmitting === 'reject' ? (
                              <Icons.loader className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Icons.close className="mr-2 h-4 w-4" />
                            )}
                            Reject
                          </Button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="rounded-lg bg-gray-50 p-4">
                          <p className="text-sm font-medium text-foreground">
                            Decision: <span className={cn('capitalize font-semibold', decisionTextColor(detail.human_decision))}>{detail.human_decision}</span> by {detail.decided_by}
                          </p>
                          {detail.human_notes && (
                            <p className="mt-1 text-sm text-muted-foreground">&quot;{detail.human_notes}&quot;</p>
                          )}
                          {detail.decided_at && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {new Date(detail.decided_at).toLocaleString()}
                            </p>
                          )}
                        </div>

                        {detail.draft_communication && (
                          <div className="mt-4 rounded-lg border border-brand-cornflower/30 bg-brand-cornflower/5 p-4">
                            <div className="flex items-center justify-between gap-2">
                              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase text-brand-cornflower">
                                <Icons.mail className="h-3.5 w-3.5" />
                                Draft Communication — review &amp; send yourself
                              </p>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  const text = `To: ${detail.draft_communication!.to}\nSubject: ${detail.draft_communication!.subject}\n\n${detail.draft_communication!.body}`
                                  navigator.clipboard?.writeText(text)
                                  setCopiedDraft(true)
                                  setTimeout(() => setCopiedDraft(false), 2000)
                                }}
                              >
                                {copiedDraft ? (
                                  <><Icons.check className="mr-1.5 h-3.5 w-3.5" />Copied</>
                                ) : (
                                  <><Icons.copy className="mr-1.5 h-3.5 w-3.5" />Copy</>
                                )}
                              </Button>
                            </div>
                            <div className="mt-2 space-y-1 text-sm">
                              <p><span className="font-medium text-foreground">To:</span> <span className="text-muted-foreground">{detail.draft_communication.to}</span></p>
                              <p><span className="font-medium text-foreground">Subject:</span> <span className="text-muted-foreground">{detail.draft_communication.subject}</span></p>
                            </div>
                            <p className="mt-2 whitespace-pre-wrap rounded-md bg-white p-3 text-sm text-foreground border border-gray-200">
                              {detail.draft_communication.body}
                            </p>
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  )
}
