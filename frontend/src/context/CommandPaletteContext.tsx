'use client'

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

// ============================================================================
// Shared open/close state for the command palette (Cmd+K search dialog).
//
// Previously the Header's search box called an `onOpenCommandPalette` prop
// that was never actually passed in, so clicking it did nothing — only the
// global Cmd+K keyboard shortcut worked. This context lets the Header (and
// anything else) open the same dialog instance instead of each having its
// own disconnected state.
// ============================================================================

interface CommandPaletteContextValue {
  isOpen: boolean
  open: () => void
  close: () => void
  setOpen: (open: boolean) => void
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null)

export function useCommandPalette(): CommandPaletteContextValue {
  const ctx = useContext(CommandPaletteContext)
  if (!ctx) {
    throw new Error('useCommandPalette must be used within a CommandPaletteProvider')
  }
  return ctx
}

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)

  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])

  return (
    <CommandPaletteContext.Provider value={{ isOpen, open, close, setOpen: setIsOpen }}>
      {children}
    </CommandPaletteContext.Provider>
  )
}
