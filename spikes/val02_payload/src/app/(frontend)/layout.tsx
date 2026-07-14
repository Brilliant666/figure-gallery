import type { Metadata } from 'next'

import './styles.css'

export const metadata: Metadata = {
  description: 'Disposable VAL-02 synthetic figure gallery prototype.',
  title: 'Figure Gallery · VAL-02 Payload POC',
}

export default function FrontendLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
