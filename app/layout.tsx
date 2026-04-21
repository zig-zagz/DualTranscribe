import type { Metadata } from 'next'
import './globals.css'
import { SessionProviderWrapper } from '@/components/session-provider'

export const metadata: Metadata = {
  title: 'Dual audio Amazon Transcribe demo',
  description:
    'Stream multi-channel audio captured in the browser to Amazon Transcribe using the Web Audio API.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-slate-900 antialiased">
        <SessionProviderWrapper>
          <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-10 sm:px-8">
            {children}
          </main>
        </SessionProviderWrapper>
      </body>
    </html>
  )
}
