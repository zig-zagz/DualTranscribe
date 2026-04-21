'use client'

import type { ReactNode } from 'react'
import { SessionProvider } from 'next-auth/react'

interface Props {
  children: ReactNode
}

export function SessionProviderWrapper({ children }: Props) {
  return <SessionProvider>{children}</SessionProvider>
}
