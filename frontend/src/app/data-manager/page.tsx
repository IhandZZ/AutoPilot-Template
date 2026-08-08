'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { apiClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { CardWatermark } from '@/components/ui/card-watermark'
import { Icons } from '@/components/ui/icons'

interface Integration {
  name: string
  category: string
  status: 'healthy' | 'configured' | 'not_configured' | 'error'
  detail: string
  latency_ms: number | null
  checked_at: string | null
  check_type: 'live' | 'static'
}

interface IntegrationsResponse {
  integrations: Integration[]
  summary: {
    total: number
    healthy_or_configured: number
    categories: string[]
  }
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
}
const itemVariants = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }

function statusConfig(status: Integration['status']) {
  switch (status) {
    case 'healthy':
      return { label: 'Healthy', dot: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700', icon: Icons.checkCircle }
    case 'configured':
      return { label: 'Configured', dot: 'bg-blue-500', badge: 'bg-blue-100 text-blue-700', icon: Icons.checkCircle }
    case 'not_configured':
      return { label: 'Not Configured', dot: 'bg-gray-400', badge: 'bg-gray-100 text-gray-600', icon: Icons.alertCircle }
    case 'error':
    default:
      return { label: 'Error', dot: 'bg-red-500', badge: 'bg-red-100 text-red-700', icon: Icons.alertCircle }
  }
}

const categoryIcon: Record<string, React.ElementType> = {
  'System of Record': Icons.folder,
  Channel: Icons.messageSquare,
  Orchestration: Icons.bot,
}

export default function DataManagerPage() {
  const [data, setData] = useState<IntegrationsResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await apiClient.get<IntegrationsResponse>('/api/data-manager/integrations')
      setData(res)
    } catch (err) {
      console.error('[Data Manager] failed to load integrations', err)
      setData(null)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const grouped = (data?.integrations || []).reduce<Record<string, Integration[]>>((acc, i) => {
    acc[i.category] = acc[i.category] || []
    acc[i.category].push(i)
    return acc
  }, {})

  return (
    <motion.div className="space-y-6" variants={containerVariants} initial="hidden" animate="visible">
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-display-3 font-bold tracking-tight text-brand-navy lg:text-display-2">
            Data Manager
          </h1>
          <p className="mt-1 text-lg text-muted-foreground">
            Live health of every system and channel the AI Employee depends on.
          </p>
        </div>
        <Button variant="outline" onClick={load} disabled={isLoading}>
          <Icons.loader className={cn('mr-2 h-4 w-4', isLoading && 'animate-spin')} />
          Refresh
        </Button>
      </motion.div>

      {data && (
        <motion.div variants={itemVariants} className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-brand-navy/10">
                <Icons.network className="h-5 w-5 text-brand-navy" />
              </div>
              <div>
                <p className="text-2xl font-bold text-brand-navy">{data.summary.total}</p>
                <p className="text-xs text-muted-foreground">Total Integrations</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-100">
                <Icons.checkCircle className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-emerald-600">{data.summary.healthy_or_configured}</p>
                <p className="text-xs text-muted-foreground">Healthy / Configured</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-100">
                <Icons.layers className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-purple-600">{data.summary.categories.length}</p>
                <p className="text-xs text-muted-foreground">Categories</p>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {isLoading && !data ? (
        <div className="flex items-center justify-center py-16">
          <Icons.loader className="h-8 w-8 animate-spin text-brand-cornflower" />
        </div>
      ) : !data ? (
        <Card className="relative overflow-hidden">
          <CardWatermark opacity={3} scale={1} />
          <CardContent className="relative z-10 flex flex-col items-center justify-center py-16 text-center">
            <Icons.alertCircle className="h-8 w-8 text-red-500 mb-3" />
            <p className="text-sm text-muted-foreground">Couldn&apos;t reach the backend. Is it running?</p>
          </CardContent>
        </Card>
      ) : (
        Object.entries(grouped).map(([category, integrations]) => {
          const CategoryIcon = categoryIcon[category] || Icons.network
          return (
            <motion.div key={category} variants={itemVariants}>
              <div className="flex items-center gap-2 mb-3">
                <CategoryIcon className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {category}
                </h2>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {integrations.map((integ) => {
                  const sc = statusConfig(integ.status)
                  const StatusIcon = sc.icon
                  return (
                    <Card key={integ.name} className="relative overflow-hidden">
                      <CardWatermark opacity={2} scale={0.8} />
                      <CardContent className="relative z-10 p-5">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-2">
                            <span className={cn('h-2 w-2 rounded-full', sc.dot)} />
                            <h3 className="font-semibold text-foreground">{integ.name}</h3>
                          </div>
                          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase flex items-center gap-1', sc.badge)}>
                            <StatusIcon className="h-3 w-3" />
                            {sc.label}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">{integ.detail}</p>
                        <div className="mt-3 flex items-center justify-between">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
                              integ.check_type === 'live'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-amber-50 text-amber-700 border border-amber-200'
                            )}
                            title={
                              integ.check_type === 'live'
                                ? 'This backend actively pings the real service.'
                                : 'This integration lives inside the Supervity Auto workflow — we report its configured state, not a live ping.'
                            }
                          >
                            {integ.check_type === 'live' ? (
                              <><Icons.activity className="h-2.5 w-2.5" /> Live Health Check</>
                            ) : (
                              <><Icons.info className="h-2.5 w-2.5" /> Configuration Status</>
                            )}
                          </span>
                          {integ.checked_at && (
                            <p className="text-xs text-muted-foreground/70">
                              Checked {new Date(integ.checked_at).toLocaleTimeString()}
                            </p>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            </motion.div>
          )
        })
      )}
    </motion.div>
  )
}
