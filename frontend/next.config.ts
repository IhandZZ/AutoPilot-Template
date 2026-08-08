import type { NextConfig } from 'next'

// Handle basePath - Next.js requires either empty string or path starting with /
// but NOT just "/" alone
const getBasePath = () => {
  const path = process.env.NEXT_PUBLIC_BASE_PATH || ''
  // "/" is not a valid basePath, treat it as empty
  if (path === '/') return ''
  return path
}

const nextConfig: NextConfig = {
  basePath: getBasePath(),

  env: {
    // Explicit undefined-check, not `||`: an intentionally empty string
    // (same-origin mode, see rewrites() below) is falsy in JS and would
    // otherwise get silently overridden back to the localhost default.
    NEXT_PUBLIC_API_URL:
      process.env.NEXT_PUBLIC_API_URL !== undefined
        ? process.env.NEXT_PUBLIC_API_URL
        : 'http://localhost:8001',
    INTERNAL_API_URL: process.env.INTERNAL_API_URL || 'http://backend:8000',
  },
  serverExternalPackages: [],

  // When NEXT_PUBLIC_API_URL is set to an empty string (same-origin mode —
  // used when the app is exposed through a single public tunnel/URL, e.g.
  // ngrok, so there's only one public hostname instead of two that would
  // need CORS wired between them), the browser calls same-origin `/api/...`
  // paths. This rewrite makes Next.js's own server proxy those through to
  // the backend container over Docker's internal network, so the browser
  // never needs to know the backend's address at all.
  async rewrites() {
    if (process.env.NEXT_PUBLIC_API_URL !== '') return []
    const internalApiUrl = process.env.INTERNAL_API_URL || 'http://backend:8000'
    return [
      {
        source: '/api/:path*',
        destination: `${internalApiUrl}/api/:path*`,
      },
    ]
  },

  // Tree-shake heavy icon/component libraries
  experimental: {
    optimizePackageImports: [
      '@radix-ui/react-icons',
      'lucide-react',
      'recharts',
      'framer-motion',
    ],
  },

  // Ensure TypeScript errors fail the build
  typescript: {
    ignoreBuildErrors: false,
  },

  // Disable source maps in production for faster builds
  productionBrowserSourceMaps: false,
}

export default nextConfig
