'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { apiClient } from '@/lib/api-client'
import { Card, CardContent } from '@/components/ui/card'
import { CardWatermark } from '@/components/ui/card-watermark'
import { Icons } from '@/components/ui/icons'
import { cn } from '@/lib/utils'
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

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

function HeroSection({ userName, summary }: { userName?: string; summary: DashboardSummary | null }) {
  const firstName = userName?.split(' ')[0] || 'there'
  return (
    <motion.div className="col-span-12 py-2" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
      <h1 className="text-display-3 font-bold tracking-tight text-brand-navy lg:text-display-2">
        Procurement Exception <br className="hidden sm:block" />
        <span className="text-gradient">Command Center.</span>
      </h1>
      <p className="mt-4 text-lg font-light text-muted-foreground">
        Welcome back, {firstName}.{' '}
        {summary
          ? summary.pending_exceptions > 0
            ? `${summary.pending_exceptions} exception${summary.pending_exceptions === 1 ? '' : 's'} need${summary.pending_exceptions === 1 ? 's' : ''} your review.`
            : 'All exceptions are clear right now.'
          : 'Loading live status...'}
      </p>
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
  const [isLoading, setIsLoading] = useState(true)

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await apiClient.get<DashboardSummary>('/api/dashboard/summary')
      setSummary(res)
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
      <HeroSection userName="Developer" summary={summary} />

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          title="Pending Exceptions"
          value={summary?.pending_exceptions ?? 0}
          icon={Icons.alertTriangle}
          subtext={summary ? `${summary.resolved_exceptions} resolved` : undefined}
          colorClass="bg-brand-navy"
          delay={0.1}
          href="/workbench"
        />
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

      {/* Recent Activity + Risk */}
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
