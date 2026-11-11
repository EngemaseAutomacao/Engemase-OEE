import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"

import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"

import "./globals.css"

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] })
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] })

export const metadata: Metadata = {
  title: { default: "Engemase OEE", template: "%s · Engemase OEE" },
  description: "Monitoramento de OEE de máquinas industriais — Engemase Engenharia",
  applicationName: "Engemase OEE",
}

/**
 * Protótipo com dados simulados: desliga a validação de navegação instantânea.
 * A implementação real lerá dados de cliente dentro de <Suspense> (docs/15, seção 4).
 */
export const instant = false

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#2c4e73" },
    { media: "(prefers-color-scheme: dark)", color: "#172b42" },
  ],
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full font-sans">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <TooltipProvider delayDuration={150}>{children}</TooltipProvider>
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  )
}
