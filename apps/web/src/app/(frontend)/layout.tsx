import React from 'react'
import './styles.css'

export const metadata = {
  description: 'Formal initialization baseline for Figure Gallery.',
  title: 'Figure Gallery',
}

export default async function RootLayout(props: { children: React.ReactNode }) {
  const { children } = props

  return (
    <html lang="zh-CN">
      <body>
        <main>{children}</main>
      </body>
    </html>
  )
}
