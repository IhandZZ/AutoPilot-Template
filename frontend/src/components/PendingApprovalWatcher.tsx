'use client'

import { useEffect, useRef } from 'react'
import { apiClient } from '@/lib/api-client'
import { toast } from '@/components/ui/toast'

// Global watcher for exceptions waiting on a human — shows a persistent
// bottom-right toast (mirroring the sidebar's red Workbench badge) so a
// pending approval is visible from any page in the Command Center, not just
// the Workbench itself, with a direct link to go handle it.
export function PendingApprovalWatcher() {
  const shownForCount = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false

    const poll = async () => {
      try {
        const items = await apiClient.get<unknown[]>('/api/workbench/items?status=pending')
        const count = Array.isArray(items) ? items.length : 0
        if (cancelled) return

        if (count > 0) {
          // Only re-trigger the toast (and its slide-in animation) when the
          // count actually changes since the last check — otherwise every
          // 15-second poll would restart the animation for no reason.
          if (shownForCount.current !== count) {
            toast.approvalNeeded(count)
            shownForCount.current = count
          }
        } else if (shownForCount.current !== null) {
          toast.dismiss('pending-approval')
          shownForCount.current = null
        }
      } catch {
        // Silent — this is a nice-to-have notification, not core functionality.
      }
    }

    poll()
    const interval = setInterval(poll, 15000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  return null
}
