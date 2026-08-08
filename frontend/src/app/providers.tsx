'use client'

import { SessionProvider } from 'next-auth/react'
import { ToastProvider } from '@/components/ui/toast'
import { CommandPalette } from '@/components/CommandPalette'
import { AIProvider } from '@/context/AIContext'
import { CommandPaletteProvider, useCommandPalette } from '@/context/CommandPaletteContext'
import { AIManager } from '@/components/ai/AIManager'

// Renders the actual dialog, wired to the shared context state, so the
// Header's search box and the Cmd+K shortcut both control the same instance.
function CommandPaletteMount() {
  const { isOpen, setOpen } = useCommandPalette()
  return <CommandPalette open={isOpen} onOpenChange={setOpen} />
}

// Mock session — all components see an authenticated admin user
const mockSession: {
  user: { name: string; email: string }
  roles: string[]
  expires: string
} = {
  user: {
    name: 'Dev User',
    email: 'dev@autopilot.local',
  },
  roles: ['admin', 'user'],
  expires: '2099-12-31T23:59:59.999Z',
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider
      session={mockSession}
      basePath={`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/api/auth`}
      refetchInterval={0}
      refetchOnWindowFocus={false}
    >
      <AIProvider>
        <CommandPaletteProvider>
          {children}
          <AIManager />
          <ToastProvider />
          <CommandPaletteMount />
        </CommandPaletteProvider>
      </AIProvider>
    </SessionProvider>
  )
}
