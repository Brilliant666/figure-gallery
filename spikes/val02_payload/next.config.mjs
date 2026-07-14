import { withPayload } from '@payloadcms/next/withPayload'

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingIncludes: {
    '/*': ['./node_modules/@img/**/*', './node_modules/sharp/**/*'],
  },
  poweredByHeader: false,
}

export default withPayload(nextConfig)
