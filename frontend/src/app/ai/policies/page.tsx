'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import { apiClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { CardWatermark } from '@/components/ui/card-watermark'
import { Icons } from '@/components/ui/icons'
import { PolicyCard, type Policy } from '@/components/ai/policies/PolicyCard'
import { PolicyDetailModal } from '@/components/ai/policies/PolicyDetailModal'
import { PolicyEditModal } from '@/components/ai/policies/PolicyEditModal'
import { CreateWithAI } from '@/components/ai/policies/CreateWithAI'
import { PermissionMatrixTab } from '@/components/ai/policies/PermissionMatrixTab'
import { StructuredBuilder } from '@/components/ai/policies/StructuredBuilder'

interface EvaluationSummary {
  total_evaluations: number
  first_evaluated_at: string | null
  last_evaluated_at: string | null
  by_decision: Record<string, number>
}

function slugify(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

// ============================================================================
// Demo Data — kept as a fallback if the backend is unreachable
// ============================================================================

const DEMO_POLICIES: Policy[] = [
  {
    id: 'demo-001',
    name: 'Auto-Approve Low Value Invoices',
    description: 'Automatically approve invoices under $500 from approved vendors.',
    natural_language: 'If an invoice total is less than $500 and the vendor is in our approved vendor list, automatically approve for payment without requiring manual review.',
    summary: 'Auto-approves low-value invoices from trusted vendors to reduce manual workload.',
    policy_type: 'logical',
    dsl: { conditions: [{ field: 'amount', operator: 'less_than', value: '500' }, { field: 'vendor_status', operator: 'equals', value: 'approved' }], actions: [{ type: 'auto_approve' }], match_mode: 'all' },
    refined_instruction: null,
    ai_instruction: 'WHEN amount < 500 AND vendor_status = approved THEN auto_approve',
    entity_name: 'invoice',
    is_active: true,
    priority: 10,
    tags: ['finance', 'auto-approve', 'demo'],
    execution_count: 120,
    last_executed_at: new Date().toISOString(),
    created_at: new Date(Date.now() - 30 * 86400000).toISOString(),
    updated_at: new Date(Date.now() - 2 * 3600000).toISOString(),
  },
  {
    id: 'demo-002',
    name: 'CFO Approval for Large Transactions',
    description: 'Require CFO approval for any transaction exceeding $50,000.',
    natural_language: 'Any transaction or purchase order exceeding $50,000 must be reviewed and approved by the CFO before processing.',
    summary: 'Enforces executive approval on high-value transactions.',
    policy_type: 'logical',
    dsl: { conditions: [{ field: 'amount', operator: 'greater_than', value: '50000' }], actions: [{ type: 'require_approval', value: 'CFO' }], match_mode: 'all' },
    refined_instruction: null,
    ai_instruction: 'WHEN amount > 50000 THEN require_approval(CFO)',
    entity_name: 'transaction',
    is_active: true,
    priority: 5,
    tags: ['finance', 'escalation', 'demo'],
    execution_count: 45,
    last_executed_at: new Date(Date.now() - 3600000).toISOString(),
    created_at: new Date(Date.now() - 25 * 86400000).toISOString(),
    updated_at: new Date(Date.now() - 4 * 3600000).toISOString(),
  },
  {
    id: 'demo-003',
    name: 'New Employee Onboarding Checklist',
    description: 'Automatically assign onboarding steps when a new employee is created.',
    natural_language: 'When a new employee record is created, automatically assign the standard onboarding checklist, notify their manager, and schedule the Day 1 orientation meeting.',
    summary: 'Triggers automated onboarding workflow for new hires.',
    policy_type: 'natural_language',
    dsl: null,
    refined_instruction: 'On new employee creation: assign onboarding checklist, notify manager, schedule Day 1 orientation.',
    ai_instruction: 'On new employee creation: assign onboarding checklist, notify manager, schedule Day 1 orientation.',
    entity_name: 'employee',
    is_active: true,
    priority: 15,
    tags: ['hr', 'onboarding', 'demo'],
    execution_count: 30,
    last_executed_at: new Date(Date.now() - 2 * 3600000).toISOString(),
    created_at: new Date(Date.now() - 20 * 86400000).toISOString(),
    updated_at: new Date(Date.now() - 6 * 3600000).toISOString(),
  },
  {
    id: 'demo-004',
    name: 'Suspicious Login Alert',
    description: 'Flag and alert on logins from new devices or unusual locations.',
    natural_language: 'If a user logs in from a new device or from a country they have never logged in from before, flag the session for security review and send an alert to the user email.',
    summary: 'Detects and alerts on anomalous login patterns for security.',
    policy_type: 'natural_language',
    dsl: null,
    refined_instruction: 'On login: if device is new OR country is new, flag session for review, send email alert.',
    ai_instruction: 'On login: if device is new OR country is new, flag session for review, send email alert.',
    entity_name: 'session',
    is_active: true,
    priority: 1,
    tags: ['security', 'alerting', 'demo'],
    execution_count: 85,
    last_executed_at: new Date(Date.now() - 30 * 60000).toISOString(),
    created_at: new Date(Date.now() - 15 * 86400000).toISOString(),
    updated_at: new Date(Date.now() - 8 * 3600000).toISOString(),
  },
  {
    id: 'demo-005',
    name: 'Enterprise Ticket Escalation',
    description: 'Auto-escalate support tickets from high-value customers.',
    natural_language: 'When a support ticket is created by an enterprise-tier customer or a customer with annual contract value over $100K, automatically escalate to Tier 2 support and set priority to high.',
    summary: 'Ensures enterprise customers receive priority support.',
    policy_type: 'logical',
    dsl: { conditions: [{ field: 'customer_tier', operator: 'equals', value: 'enterprise' }], actions: [{ type: 'escalate', value: 'tier_2' }, { type: 'set_priority', value: 'high' }], match_mode: 'any' },
    refined_instruction: null,
    ai_instruction: 'WHEN customer_tier = enterprise OR contract_value > 100000 THEN escalate(tier_2), set_priority(high)',
    entity_name: 'ticket',
    is_active: false,
    priority: 8,
    tags: ['support', 'escalation', 'demo'],
    execution_count: 15,
    last_executed_at: new Date(Date.now() - 12 * 3600000).toISOString(),
    created_at: new Date(Date.now() - 10 * 86400000).toISOString(),
    updated_at: new Date(Date.now() - 10 * 3600000).toISOString(),
  },
]

// ============================================================================
// Animation Variants
// ============================================================================

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
}

// ============================================================================
// Types
// ============================================================================

type TabType = 'policies' | 'create-ai' | 'structured' | 'matrix'
type FilterType = 'all' | 'active' | 'inactive' | 'logical' | 'natural_language'
type SortType = 'newest' | 'oldest' | 'priority' | 'name' | 'executions'

// ============================================================================
// Tab Configuration
// ============================================================================

const TABS = [
  { id: 'policies' as TabType, label: 'Policies', Icon: Icons.layers },
  { id: 'create-ai' as TabType, label: 'Create with AI', Icon: Icons.sparkles },
  { id: 'structured' as TabType, label: 'Structured Builder', Icon: Icons.grid },
  { id: 'matrix' as TabType, label: 'Permission Matrix', Icon: Icons.table },
]

// ============================================================================
// Page Component
// ============================================================================

export default function AIPoliciesPage() {
  // State
  const [policies, setPolicies] = useState<Policy[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [evalSummary, setEvalSummary] = useState<EvaluationSummary | null>(null)
  const [activeTab, setActiveTab] = useState<TabType>('policies')
  
  // Modal state
  const [selectedPolicy, setSelectedPolicy] = useState<Policy | null>(null)
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false)
  const [editingPolicy, setEditingPolicy] = useState<Policy | null>(null)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  
  // Filters
  const [filter, setFilter] = useState<FilterType>('all')
  const [sortBy, setSortBy] = useState<SortType>('newest')
  const [searchQuery, setSearchQuery] = useState('')

  // Structured builder state
  const [structuredDSL, setStructuredDSL] = useState<{conditions: Array<{field: string; operator: string; value: string}>; actions: Array<{type: string; value?: string}>; match_mode: 'all' | 'any'} | null>(null)
  const [structuredName, setStructuredName] = useState('')
  const [isSavingStructured, setIsSavingStructured] = useState(false)

  // ============================================================================
  // Data — Loaded from demo data (replace with API fetch)
  // ============================================================================

  const loadPolicies = useCallback(async () => {
    setIsLoading(true)
    try {
      const [data, summary] = await Promise.all([
        apiClient.get<Policy[]>('/api/policies'),
        apiClient.get<EvaluationSummary>('/api/policies/evaluations/summary').catch(() => null),
      ])
      setPolicies(data)
      setEvalSummary(summary)
    } catch (err) {
      console.error('[Policies] failed to load from backend, falling back to demo data', err)
      setPolicies(DEMO_POLICIES)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPolicies()
  }, [loadPolicies])

  // ============================================================================
  // Policy Actions
  // ============================================================================

  const handleCardClick = useCallback((policy: Policy) => {
    setSelectedPolicy(policy)
    setIsDetailModalOpen(true)
  }, [])

  const handleEditFromDetail = useCallback((policy: Policy) => {
    setEditingPolicy(policy)
    setIsEditModalOpen(true)
  }, [])

  const handleSavePolicy = useCallback(async () => {
    loadPolicies()
  }, [loadPolicies])

  const togglePolicyStatus = useCallback(async (id: string, _isActive: boolean) => {
    // exception_config rows don't have an is_active column — every row is a
    // live rule the Auto Operators read on every run. Toggling isn't a
    // meaningful backend operation here, so this stays a local UI-only
    // affordance. Use delete to actually remove a rule.
    setPolicies(prev => prev.map(p => p.id === id ? { ...p, is_active: !p.is_active } : p))
  }, [])

  const deletePolicy = useCallback(async (id: string) => {
    try {
      await apiClient.delete(`/api/policies/${id}`)
      setPolicies(prev => prev.filter(p => p.id !== id))
    } catch (err) {
      console.error('[Policies] failed to delete', err)
    }
  }, [])

  const handlePolicyCreate = async (policyData: {
    name: string
    description: string
    naturalLanguage: string
    policyType: 'logical' | 'natural_language'
    dsl: unknown
    refinedInstruction: string | null
    entityName: string | null
    tags: string[]
    priority: number
  }) => {
    const key = slugify(policyData.name)
    // Best-effort default value: pull the first condition's value out of a
    // structured DSL, otherwise fall back to the natural language text —
    // exception_config stores a single scalar `value` per key.
    const dsl = policyData.dsl as { conditions?: { value?: string }[] } | null
    const value = dsl?.conditions?.[0]?.value ?? policyData.naturalLanguage.slice(0, 200)

    try {
      const created = await apiClient.post<Policy>('/api/policies', {
        key,
        value,
        description: policyData.description || policyData.naturalLanguage,
      })
      setPolicies(prev => [created, ...prev])
      setActiveTab('policies')
    } catch (err) {
      console.error('[Policies] failed to create', err)
      // Re-throw so callers (e.g. CreateWithAI's wizard) can show their own
      // error state instead of the save silently no-op'ing.
      throw err
    }
  }

  // ============================================================================
  // Filtering & Sorting
  // ============================================================================

  const filteredPolicies = policies
    .filter((policy) => {
      if (filter === 'active' && !policy.is_active) return false
      if (filter === 'inactive' && policy.is_active) return false
      if (filter === 'logical' && policy.policy_type !== 'logical') return false
      if (filter === 'natural_language' && policy.policy_type !== 'natural_language') return false

      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        return (
          policy.name.toLowerCase().includes(query) ||
          policy.description.toLowerCase().includes(query) ||
          policy.natural_language.toLowerCase().includes(query) ||
          policy.tags.some((tag) => tag.toLowerCase().includes(query))
        )
      }

      return true
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'newest':
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        case 'oldest':
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        case 'priority':
          return a.priority - b.priority
        case 'name':
          return a.name.localeCompare(b.name)
        case 'executions':
          return b.execution_count - a.execution_count
        default:
          return 0
      }
    })

  // ============================================================================
  // Stats
  // ============================================================================

  const stats = {
    total: policies.length,
    active: policies.filter((p) => p.is_active).length,
    structured: policies.filter((p) => p.policy_type === 'logical').length,
    natural: policies.filter((p) => p.policy_type === 'natural_language').length,
  }

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <motion.div
      className="space-y-6"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Header */}
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-display-3 font-bold tracking-tight text-brand-navy lg:text-display-2">
            AI Policies
          </h1>
          <p className="mt-1 text-lg text-muted-foreground">
            Define business rules in natural language. The AI determines the best format.
          </p>
        </div>
        <Button
          variant="gradient"
          onClick={() => setActiveTab('create-ai')}
          className={activeTab !== 'policies' ? 'opacity-50' : ''}
        >
          <Icons.plus className="mr-2 h-4 w-4" />
          Create Policy
        </Button>
      </motion.div>

      {/* Tabs - AT THE TOP */}
      <motion.div variants={itemVariants}>
        <div className="flex gap-1 p-1.5 bg-gray-100 rounded-xl">
          {TABS.map((tab) => (
            <motion.button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'relative flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors',
                activeTab === tab.id
                  ? 'text-brand-navy'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              whileHover={{ scale: activeTab === tab.id ? 1 : 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              {activeTab === tab.id && (
                <motion.div
                  layoutId="activeTab"
                  className="absolute inset-0 bg-white rounded-lg shadow-sm"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
              <span className="relative z-10 flex items-center gap-2">
                <tab.Icon className="h-4 w-4" />
                {tab.label}
              </span>
            </motion.button>
          ))}
        </div>
      </motion.div>

      {/* Tab Content - Use initial={false} on first render to avoid blank state */}
      <AnimatePresence mode="popLayout">
        {activeTab === 'policies' && (
          <motion.div
            key="policies-tab"
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.15 }}
            className="space-y-6"
          >
          {/* Stats Bar - No initial animation to prevent blank flash */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            {[
              { value: stats.total, label: 'Total Policies', icon: Icons.layers, bg: 'bg-brand-navy/10', color: 'text-brand-navy' },
              { value: stats.active, label: 'Active', icon: Icons.check, bg: 'bg-emerald-100', color: 'text-emerald-600' },
              { value: stats.structured, label: 'Structured', icon: Icons.grid, bg: 'bg-blue-100', color: 'text-blue-600' },
              { value: stats.natural, label: 'Natural Language', icon: Icons.brain, bg: 'bg-purple-100', color: 'text-purple-600' },
              { value: evalSummary?.total_evaluations ?? '—', label: 'Evaluations Logged', icon: Icons.activity, bg: 'bg-amber-100', color: 'text-amber-600' },
            ].map((stat) => (
              <motion.div 
                key={stat.label}
                className="bg-white rounded-xl border border-gray-200 p-4 hover:border-gray-300 hover:shadow-md transition-all cursor-default"
                whileHover={{ y: -2, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
              >
                <div className="flex items-center gap-3">
                  <motion.div 
                    className={cn('p-2 rounded-lg', stat.bg)}
                    whileHover={{ scale: 1.1, rotate: 5 }}
                    transition={{ type: 'spring', stiffness: 400 }}
                  >
                    <stat.icon className={cn('h-5 w-5', stat.color)} />
                  </motion.div>
                  <div>
                    <p className={cn('text-2xl font-bold', stat.color)}>
                      {stat.value}
                    </p>
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Filters & Search */}
          <motion.div variants={itemVariants} className="flex flex-col sm:flex-row gap-4">
            {/* Search */}
            <div className="relative flex-1">
              <Icons.search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search policies..."
                className={cn(
                  'w-full pl-10 pr-4 py-2.5 rounded-lg border border-input bg-white',
                  'text-sm focus:outline-none focus:ring-2 focus:ring-brand-cornflower/50'
                )}
              />
            </div>

            {/* Filter */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground whitespace-nowrap">Filter:</span>
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as FilterType)}
                className="px-3 py-2.5 rounded-lg border border-input bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-cornflower/50"
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="logical">Structured</option>
                <option value="natural_language">Natural Language</option>
              </select>
            </div>

            {/* Sort */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground whitespace-nowrap">Sort:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortType)}
                className="px-3 py-2.5 rounded-lg border border-input bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-cornflower/50"
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="priority">Priority</option>
                <option value="name">Name</option>
                <option value="executions">Most Used</option>
              </select>
            </div>
          </motion.div>

          {/* Policy Grid */}
          <motion.div variants={itemVariants}>
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Icons.loader className="h-8 w-8 animate-spin text-brand-cornflower" />
              </div>
            ) : filteredPolicies.length === 0 ? (
              <Card className="relative overflow-hidden">
                <CardWatermark opacity={3} scale={1} />
                <CardContent className="relative z-10 flex flex-col items-center justify-center py-16 text-center">
                  <div className={cn(
                    'mb-4 flex h-16 w-16 items-center justify-center rounded-2xl',
                    'bg-gradient-to-br from-brand-cornflower/20 to-brand-purple/20'
                  )}>
                    <Icons.brain className="h-8 w-8 text-brand-cornflower" strokeWidth={1.5} />
                  </div>
                  <h3 className="font-display text-lg font-semibold text-brand-navy">
                    {searchQuery || filter !== 'all' ? 'No matching policies' : 'No policies yet'}
                  </h3>
                  <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                    {searchQuery || filter !== 'all'
                      ? 'Try adjusting your search or filter criteria.'
                      : 'Create your first AI policy using natural language.'}
                  </p>
                  <Button
                    variant="gradient"
                    className="mt-6"
                    onClick={() => setActiveTab('create-ai')}
                  >
                    <Icons.sparkles className="mr-2 h-4 w-4" />
                    Create with AI
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredPolicies.map((policy) => (
                  <PolicyCard
                    key={policy.id}
                    policy={policy}
                    onClick={handleCardClick}
                  />
                ))}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}

      {activeTab === 'create-ai' && (
        <motion.div
          key="create-ai-tab"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.15 }}
        >
          <Card className="relative overflow-hidden">
            <CardWatermark opacity={2} scale={1} />
            <CardContent className="relative z-10 py-8">
              <CreateWithAI
                onPolicyCreate={handlePolicyCreate}
                onCancel={() => setActiveTab('policies')}
              />
            </CardContent>
          </Card>
        </motion.div>
      )}

      {activeTab === 'structured' && (
        <motion.div
          key="structured-tab"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.15 }}
        >
          <Card className="relative overflow-hidden">
            <CardWatermark opacity={2} scale={1} />
            <CardContent className="relative z-10 py-8">
              <div className="max-w-3xl mx-auto">
                <div className="text-center mb-8">
                  <h2 className="text-xl font-bold text-brand-navy mb-2">
                    Structured Rule Builder
                  </h2>
                  <p className="text-muted-foreground">
                    Visually build rules with conditions and actions
                  </p>
                </div>
                <div className="mb-6">
                  <label className="block text-sm font-medium text-foreground mb-1.5">Rule Name *</label>
                  <input
                    type="text"
                    value={structuredName}
                    onChange={(e) => setStructuredName(e.target.value)}
                    placeholder="e.g., Auto-Approve Low Value Items"
                    className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-base focus:outline-none focus:ring-2 focus:ring-brand-cornflower/50"
                  />
                </div>
                <StructuredBuilder
                  onChange={(dsl) => setStructuredDSL(dsl)}
                />
                <div className="flex justify-center gap-3 mt-8">
                  <Button variant="ghost" onClick={() => setActiveTab('policies')}>
                    Cancel
                  </Button>
                  <Button
                    variant="gradient"
                    disabled={!structuredDSL || structuredDSL.conditions.length === 0 || !structuredName.trim() || isSavingStructured}
                    onClick={async () => {
                      if (!structuredDSL || !structuredName.trim()) return
                      setIsSavingStructured(true)
                      try {
                        await handlePolicyCreate({
                          name: structuredName.trim(),
                          description: '',
                          naturalLanguage: `Structured rule: ${structuredName}`,
                          policyType: 'logical',
                          dsl: {
                            conditions: structuredDSL.conditions.map(c => ({ field: c.field, operator: c.operator, value: c.value })),
                            actions: structuredDSL.actions.map(a => ({ type: a.type, value: a.value })),
                            match_mode: structuredDSL.match_mode,
                          },
                          refinedInstruction: null,
                          entityName: null,
                          tags: ['structured'],
                          priority: 50,
                        })
                        setStructuredName('')
                        setStructuredDSL(null)
                      } finally {
                        setIsSavingStructured(false)
                      }
                    }}
                  >
                    {isSavingStructured ? (
                      <><Icons.loader className="mr-2 h-4 w-4 animate-spin" />Saving...</>
                    ) : (
                      <><Icons.check className="mr-2 h-4 w-4" />Save Policy</>
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {activeTab === 'matrix' && (
        <motion.div
          key="matrix-tab"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.15 }}
        >
          <PermissionMatrixTab />
        </motion.div>
      )}
      </AnimatePresence>

      {/* Detail Modal - View only */}
      <PolicyDetailModal
        policy={selectedPolicy}
        isOpen={isDetailModalOpen}
        onClose={() => {
          setIsDetailModalOpen(false)
          setSelectedPolicy(null)
        }}
        onEdit={handleEditFromDetail}
        onToggleStatus={(id, isActive) => {
          togglePolicyStatus(id, isActive)
          setIsDetailModalOpen(false)
        }}
        onDelete={(id) => {
          deletePolicy(id)
          setIsDetailModalOpen(false)
        }}
      />

      {/* Edit Modal */}
      <PolicyEditModal
        policy={editingPolicy}
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false)
          setEditingPolicy(null)
        }}
        onSave={handleSavePolicy}
      />
    </motion.div>
  )
}
