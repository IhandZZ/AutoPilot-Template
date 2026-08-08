'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { apiClient } from '@/lib/api-client'
import { Card, CardContent } from '@/components/ui/card'
import { CardWatermark } from '@/components/ui/card-watermark'
import { Icons } from '@/components/ui/icons'
import { cn } from '@/lib/utils'
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

// ============================================================================
// Types — mirrors app/schemas/dashboard.py
// ============================================================================

interface RecentIncident {
  notice_id: string | null
  supplier_name: string | null
  item_number: string | null
  severity: string | null
  action_taken: string | null
  escalated: boolean | null
  cost_avoided_myr: number
  created_at: string | null
}

interface TopRiskSupplier {
  supplier_id: string
  supplier_name: string | null
  risk_score: number
  risk_band: string | null
  incident_count: number
}

interface DashboardSummary {
  pending_exceptions: number
  resolved_exceptions: number
  total_cost_avoided_myr: number
  total_value_at_risk_myr: number
  active_policies: number
  total_evaluations: number
  notices_total: number
  notices_processed: number
  high_risk_suppliers: number
  recent_incidents: RecentIncident[]
  top_risk_suppliers: TopRiskSupplier[]
}

// Mirrors app/schemas/insights.py — only the fields the dashboard card needs.
interface Insight {
  id: string
  type: string
  severity: string
  title: string
  description: string
  suggested_action: string | null
}

interface InsightsResponse {
  insights: Insight[]
}

// Animation variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1, delayChildren: 0.1 } },
}
const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] } },
}

function AnimatedNumber({ value, suffix = '', duration = 900 }: { value: number; suffix?: string; duration?: number }) {
  const [displayValue, setDisplayValue] = useState(0)

  // These stat cards sit above the fold and are visible the instant the
  // page loads, so gate the count-up on the value actually arriving from
  // the API rather than a scroll-triggered IntersectionObserver — the
  // observer-based version (useInView) could get stuck reporting "not in
  // view" for cards that are already on screen at mount, leaving the
  // number frozen at its initial 0 even though the real data loaded fine.
  useEffect(() => {
    if (!value) {
      setDisplayValue(0)
      return
    }
    let cancelled = false
    const startTime = performance.now()
    const animate = (currentTime: number) => {
      if (cancelled) return
      const elapsed = currentTime - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(2, -10 * progress)
      setDisplayValue(Math.round(eased * value))
      if (progress < 1) requestAnimationFrame(animate)
      else setDisplayValue(value)
    }
    requestAnimationFrame(animate)
    return () => {
      cancelled = true
    }
  }, [value, duration])

  const formatValue = (num: number): string => {
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M'
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K'
    return num.toString()
  }

  return <span>{formatValue(displayValue)}{suffix}</span>
}

interface StatCardProps {
  title: string
  value: number
  suffix?: string
  icon: React.ElementType
  subtext?: string
  colorClass: string
  delay?: number
  href?: string
}

function StatCard({ title, value, suffix = '', icon: Icon, subtext, colorClass, delay = 0, href }: StatCardProps) {
  const content = (
    <Card className="group relative h-full cursor-default overflow-hidden">
      <CardWatermark opacity={3} scale={0.9} />
      <CardContent className="relative z-10 p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <p className="text-micro uppercase text-brand-muted transition-colors duration-200 group-hover:text-brand-cornflower">
              {title}
            </p>
            <p className="font-display text-[2.25rem] font-bold leading-none tracking-tight text-brand-navy">
              <AnimatedNumber value={value} suffix={suffix} />
            </p>
            {subtext && <p className="text-xs font-medium text-muted-foreground">{subtext}</p>}
          </div>
          <div className={cn('rounded-xl p-2.5 text-white shadow-lg', colorClass)}>
            <Icon className="h-5 w-5" strokeWidth={1.5} />
          </div>
        </div>
      </CardContent>
    </Card>
  )

  return (
    <motion.div variants={itemVariants} initial="hidden" animate="visible" transition={{ delay }} whileHover={{ y: -4 }}>
      {href ? <Link href={href}>{content}</Link> : content}
    </motion.div>
  )
}

// Overall operational state, condensed into one glance instead of making the
// user cross-reference several numbers to figure out how things are going.
function operationalStatus(summary: DashboardSummary | null, insights: Insight[]): {
  label: string
  dot: string
  text: string
} {
  if (!summary) return { label: 'Loading', dot: 'bg-gray-300', text: 'text-muted-foreground' }
  const hasCritical = insights.some((i) => i.severity.toLowerCase() === 'critical')
  if (hasCritical || summary.pending_exceptions >= 5) {
    return { label: 'Needs attention', dot: 'bg-red-500', text: 'text-red-700' }
  }
  if (summary.pending_exceptions > 0) {
    return { label: 'Reviewing exceptions', dot: 'bg-amber-500', text: 'text-amber-700' }
  }
  return { label: 'All clear', dot: 'bg-emerald-500', text: 'text-emerald-700' }
}

function HeroSection({
  userName,
  summary,
  insights,
}: {
  userName?: string
  summary: DashboardSummary | null
  insights: Insight[]
}) {
  const firstName = userName?.split(' ')[0] || 'there'
  const status = operationalStatus(summary, insights)
  return (
    <motion.div className="col-span-12 py-2" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-display-3 font-bold tracking-tight text-brand-navy lg:text-display-2">
          Procurement Exception <br className="hidden sm:block" />
          <span className="text-gradient">Command Center.</span>
        </h1>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className={cn('inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-semibold shadow-sm', status.text)}>
          <span className={cn('h-2 w-2 rounded-full', status.dot)} />
          {status.label}
        </span>
        <p className="text-lg font-light text-muted-foreground">
          Welcome back, {firstName}.{' '}
          {summary
            ? summary.pending_exceptions > 0
              ? `${summary.pending_exceptions} exception${summary.pending_exceptions === 1 ? '' : 's'} need${summary.pending_exceptions === 1 ? 's' : ''} your review.`
              : 'All exceptions are clear right now.'
            : 'Loading live status...'}
        </p>
      </div>
    </motion.div>
  )
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return <p className="text-micro font-semibold uppercase tracking-wider text-brand-muted">{children}</p>
}

function QuickActions() {
  return (
    <motion.div variants={itemVariants} className="flex flex-wrap gap-3">
      <Link
        href="/new-disruption"
        className="inline-flex items-center gap-2 rounded-lg bg-brand-navy px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-transform hover:-translate-y-0.5"
      >
        <Icons.zap className="h-4 w-4" strokeWidth={1.5} />
        Submit New Disruption
      </Link>
      <Link
        href="/workbench"
        className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-brand-navy shadow-sm transition-transform hover:-translate-y-0.5"
      >
        <Icons.workbench className="h-4 w-4" strokeWidth={1.5} />
        Review Workbench
      </Link>
      <Link
        href="/ai/insights"
        className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-brand-navy shadow-sm transition-transform hover:-translate-y-0.5"
      >
        <Icons.sparkles className="h-4 w-4" strokeWidth={1.5} />
        View AI Insights
      </Link>
    </motion.div>
  )
}

// Only appears when there's something worth interrupting the user for, so it
// never becomes noise on a genuinely quiet day.
function AttentionBanner({ summary, insights }: { summary: DashboardSummary | null; insights: Insight[] }) {
  if (!summary) return null
  const worst = insights.find((i) => i.severity.toLowerCase() === 'critical') || insights.find((i) => i.severity.toLowerCase() === 'high')
  if (summary.pending_exceptions === 0 && !worst) return null

  const isCritical = !!insights.find((i) => i.severity.toLowerCase() === 'critical')
  // Route to wherever the action actually lives: a real pending exception
  // belongs in the Workbench, but a general risk observation (like "X is
  // your highest-risk supplier") has nothing queued there — it belongs on
  // the Insights page, where its full detail and suggested action are shown.
  const hasPending = summary.pending_exceptions > 0
  const targetHref = hasPending ? '/workbench' : '/ai/insights'
  const ctaLabel = hasPending ? 'Review Now' : 'View Insight'
  return (
    <motion.div
      variants={itemVariants}
      className={cn(
        'flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between',
        isCritical ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'
      )}
    >
      <div className="flex items-start gap-3">
        <Icons.alertTriangle className={cn('mt-0.5 h-5 w-5 shrink-0', isCritical ? 'text-red-600' : 'text-amber-600')} strokeWidth={1.5} />
        <div>
          <p className={cn('text-sm font-semibold', isCritical ? 'text-red-800' : 'text-amber-800')}>
            {hasPending
              ? `${summary.pending_exceptions} exception${summary.pending_exceptions === 1 ? '' : 's'} waiting for your review`
              : worst?.title}
          </p>
          {worst && (
            <p className="mt-0.5 text-xs text-muted-foreground">{worst.suggested_action || worst.title}</p>
          )}
        </div>
      </div>
      <Link href={targetHref} className="shrink-0">
        <button
          className={cn(
            'rounded-lg px-4 py-2 text-xs font-semibold text-white transition-colors',
            isCritical ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'
          )}
        >
          {ctaLabel}
        </button>
      </Link>
    </motion.div>
  )
}

// Replaces a bare "Pending Exceptions" number with a resolved-vs-pending
// ring, so resolution progress reads visually instead of requiring the user
// to do the subtraction themselves.
function ResolutionRingCard({ summary, delay }: { summary: DashboardSummary | null; delay: number }) {
  const pending = summary?.pending_exceptions ?? 0
  const resolved = summary?.resolved_exceptions ?? 0
  const total = pending + resolved
  const data =
    total > 0
      ? [
          { name: 'Pending', value: pending, color: '#dc2626' },
          { name: 'Resolved', value: resolved, color: '#059669' },
        ]
      : [{ name: 'None', value: 1, color: '#e5e7eb' }]

  return (
    <motion.div variants={itemVariants} initial="hidden" animate="visible" transition={{ delay }} whileHover={{ y: -4 }}>
      <Link href="/workbench">
        <Card className="group relative h-full cursor-default overflow-hidden">
          <CardWatermark opacity={3} scale={0.9} />
          <CardContent className="relative z-10 p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-2">
                <p className="text-micro uppercase text-brand-muted transition-colors duration-200 group-hover:text-brand-cornflower">
                  Pending Exceptions
                </p>
                <p className="font-display text-[2.25rem] font-bold leading-none tracking-tight text-brand-navy">
                  <AnimatedNumber value={pending} />
                </p>
                <p className="text-xs font-medium text-muted-foreground">{resolved} resolved</p>
              </div>
              <div className="h-16 w-16 shrink-0">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={data} dataKey="value" innerRadius={20} outerRadius={30} startAngle={90} endAngle={-270} strokeWidth={0}>
                      {data.map((d, i) => (
                        <Cell key={i} fill={d.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </CardContent>
        </Card>
      </Link>
    </motion.div>
  )
}

function severityBadge(severity: string | null) {
  switch ((severity || '').toLowerCase()) {
    case 'high':
    case 'critical':
      return 'bg-red-100 text-red-700'
    case 'medium':
    case 'warning':
      return 'bg-amber-100 text-amber-700'
    default:
      return 'bg-blue-100 text-blue-700'
  }
}

// Hex equivalents of riskBadge's Tailwind colors, for the recharts bar fill
// (Tailwind classes don't apply to SVG fill attributes).
function riskHexColor(band: string | null): string {
  switch ((band || '').toLowerCase()) {
    case 'critical':
      return '#dc2626' // red-600
    case 'high':
      return '#ea580c' // orange-600
    case 'medium':
      return '#d97706' // amber-600
    default:
      return '#059669' // emerald-600
  }
}

// Rank + styling for insight severities, so the dashboard can show the most
// urgent AI suggestions first without the user having to read every number
// on the page to figure out what matters.
const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, warning: 2, medium: 2, low: 3, info: 4 }

function insightSeverityStyle(severity: string) {
  switch (severity.toLowerCase()) {
    case 'critical':
      return { border: 'border-l-red-600', badge: 'bg-red-100 text-red-700', icon: Icons.alertTriangle }
    case 'high':
      return { border: 'border-l-orange-500', badge: 'bg-orange-100 text-orange-700', icon: Icons.alertTriangle }
    case 'warning':
    case 'medium':
      return { border: 'border-l-amber-500', badge: 'bg-amber-100 text-amber-700', icon: Icons.lightbulb }
    default:
      return { border: 'border-l-blue-500', badge: 'bg-blue-100 text-blue-700', icon: Icons.info }
  }
}

function RiskChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: TopRiskSupplier }> }) {
  if (!active || !payload || !payload.length) return null
  const s = payload[0].payload
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg text-xs">
      <p className="font-semibold text-foreground">{s.supplier_name || s.supplier_id}</p>
      <p className="text-muted-foreground mt-0.5">
        Risk score: <span className="font-semibold text-foreground">{s.risk_score.toFixed(0)}</span>
      </p>
      <p className="text-muted-foreground">
        {s.incident_count} incident(s) · <span className="uppercase">{s.risk_band || 'low'}</span>
      </p>
    </div>
  )
}

export default function HomePage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [insights, setInsights] = useState<Insight[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const [summaryRes, insightsRes] = await Promise.all([
        apiClient.get<DashboardSummary>('/api/dashboard/summary'),
        // Insights are a nice-to-have on this page — if the endpoint has a
        // hiccup, the dashboard should still render its core KPIs rather
        // than fail entirely, so this one is caught separately below.
        apiClient.get<InsightsResponse>('/api/insights').catch(() => null),
      ])
      setSummary(summaryRes)
      if (insightsRes) {
        const sorted = [...insightsRes.insights].sort(
          (a, b) => (SEVERITY_RANK[a.severity.toLowerCase()] ?? 5) - (SEVERITY_RANK[b.severity.toLowerCase()] ?? 5)
        )
        setInsights(sorted.slice(0, 3))
      }
    } catch (err) {
      console.error('[Dashboard] failed to load summary', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <motion.div className="space-y-6" variants={containerVariants} initial="hidden" animate="visible">
      <HeroSection userName="Developer" summary={summary} insights={insights} />

      <QuickActions />

      {!isLoading && <AttentionBanner summary={summary} insights={insights} />}

      {/* Stats Grid */}
      <SectionHeader>Today&apos;s Snapshot</SectionHeader>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <ResolutionRingCard summary={summary} delay={0.1} />
        <StatCard
          title="Cost Avoided"
          value={Math.round(summary?.total_cost_avoided_myr ?? 0)}
          suffix=" MYR"
          icon={Icons.trendingUp}
          subtext={summary ? `${Math.round(summary.total_value_at_risk_myr).toLocaleString()} MYR at risk logged` : undefined}
          colorClass="bg-emerald-600"
          delay={0.2}
        />
        <StatCard
          title="Active Policies"
          value={summary?.active_policies ?? 0}
          icon={Icons.brain}
          subtext={summary ? `${summary.total_evaluations} evaluations logged` : undefined}
          colorClass="bg-brand-purple"
          delay={0.3}
          href="/ai/policies"
        />
        <StatCard
          title="High-Risk Suppliers"
          value={summary?.high_risk_suppliers ?? 0}
          icon={Icons.building}
          subtext={summary ? `${summary.notices_processed}/${summary.notices_total} notices processed` : undefined}
          colorClass="bg-gradient-to-br from-brand-navy to-brand-purple"
          delay={0.4}
          href="/data-manager"
        />
      </div>

      {/* AI Recommendations — surfaces what the AI actually suggests doing,
          so the user isn't left to interpret raw numbers on their own. */}
      {!isLoading && insights.length > 0 && (
        <motion.div variants={itemVariants}>
          <Card className="relative overflow-hidden">
            <CardWatermark opacity={2} scale={1} />
            <CardContent className="relative z-10 p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="rounded-lg bg-brand-purple/10 p-1.5">
                    <Icons.sparkles className="h-4 w-4 text-brand-purple" strokeWidth={1.5} />
                  </div>
                  <h3 className="font-display text-lg font-semibold text-brand-navy">AI Recommends</h3>
                </div>
                <Link href="/ai/insights" className="text-xs font-medium text-brand-cornflower hover:underline">
                  View all insights →
                </Link>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {insights.map((insight) => {
                  const style = insightSeverityStyle(insight.severity)
                  const Icon = style.icon
                  return (
                    <div
                      key={insight.id}
                      className={cn('rounded-lg border-l-4 bg-gray-50 p-3', style.border)}
                    >
                      <div className="flex items-start gap-2">
                        <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-foreground">{insight.title}</p>
                            <span className={cn('rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase', style.badge)}>
                              {insight.severity}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{insight.description}</p>
                          {insight.suggested_action && (
                            <p className="text-xs font-medium text-brand-navy mt-2 flex items-start gap-1">
                              <Icons.arrowRight className="h-3 w-3 mt-0.5 shrink-0" />
                              {insight.suggested_action}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Recent Activity + Risk */}
      <SectionHeader>Activity &amp; Risk</SectionHeader>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div variants={itemVariants}>
          <Card className="relative overflow-hidden h-full">
            <CardWatermark opacity={2} scale={1} />
            <CardContent className="relative z-10 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display text-lg font-semibold text-brand-navy">Recent Activity</h3>
                <Link href="/ai/insights" className="text-xs font-medium text-brand-cornflower hover:underline">
                  View Insights →
                </Link>
              </div>
              {isLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Icons.loader className="h-6 w-6 animate-spin text-brand-cornflower" />
                </div>
              ) : !summary || summary.recent_incidents.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No incidents logged yet.</p>
              ) : (
                <div className="space-y-3">
                  {summary.recent_incidents.map((inc, idx) => (
                    <div key={idx} className="flex items-start justify-between gap-3 rounded-lg bg-gray-50 p-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-foreground truncate">
                            {inc.notice_id || 'Notice'}
                          </span>
                          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase', severityBadge(inc.severity))}>
                            {inc.severity || 'unknown'}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {inc.supplier_name || 'Unknown supplier'} · {inc.action_taken || (inc.escalated ? 'Escalated' : 'Auto-resolved')}
                        </p>
                      </div>
                      <span className="text-xs font-medium text-emerald-600 whitespace-nowrap">
                        {inc.cost_avoided_myr > 0 ? `+MYR ${inc.cost_avoided_myr.toLocaleString()}` : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={itemVariants}>
          <Card className="relative overflow-hidden h-full">
            <CardWatermark opacity={2} scale={1} />
            <CardContent className="relative z-10 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display text-lg font-semibold text-brand-navy">Top Risk Suppliers</h3>
                <Link href="/data-manager" className="text-xs font-medium text-brand-cornflower hover:underline">
                  Data Manager →
                </Link>
              </div>
              {isLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Icons.loader className="h-6 w-6 animate-spin text-brand-cornflower" />
                </div>
              ) : !summary || summary.top_risk_suppliers.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No supplier risk data yet.</p>
              ) : (
                <>
                  {/* Top 5 highest-risk suppliers by risk score, color-coded
                      by risk band (matches the badge colors used elsewhere). */}
                  <div style={{ width: '100%', height: Math.max(summary.top_risk_suppliers.length * 44, 160) }}>
                    <ResponsiveContainer>
                      <BarChart
                        data={summary.top_risk_suppliers}
                        layout="vertical"
                        margin={{ top: 0, right: 24, bottom: 0, left: 0 }}
                        barCategoryGap={10}
                      >
                        <XAxis type="number" domain={[0, 100]} hide />
                        <YAxis
                          type="category"
                          dataKey="supplier_name"
                          width={130}
                          tick={{ fontSize: 12, fill: '#374151' }}
                          tickFormatter={(value: string, idx: number) =>
                            value || summary.top_risk_suppliers[idx]?.supplier_id || 'Unknown'
                          }
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip content={<RiskChartTooltip />} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
                        <Bar dataKey="risk_score" radius={[0, 6, 6, 0]} maxBarSize={22}>
                          {summary.top_risk_suppliers.map((s) => (
                            <Cell key={s.supplier_id} fill={riskHexColor(s.risk_band)} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
                    {['critical', 'high', 'medium', 'low'].map((band) => (
                      <span key={band} className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: riskHexColor(band) }} />
                        <span className="uppercase">{band}</span>
                      </span>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  )
}
