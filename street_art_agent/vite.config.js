import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

function hordeImageProxy() {
  return {
    name: 'horde-image-proxy',
    configureServer(server) {
      server.middlewares.use('/horde-img-proxy', async (req, res) => {
        const url = decodeURIComponent(req.url.replace(/^\//, ''))
        if (!url.startsWith('http')) {
          res.writeHead(400)
          res.end('Bad request')
          return
        }
        try {
          const response = await fetch(url)
          if (!response.ok) {
            res.writeHead(response.status)
            res.end(`Upstream error: ${response.status}`)
            return
          }
          res.writeHead(200, {
            'Content-Type': response.headers.get('content-type') || 'image/webp',
            'Cache-Control': 'public, max-age=3600',
          })
          const buffer = await response.arrayBuffer()
          res.end(Buffer.from(buffer))
        } catch (e) {
          res.writeHead(502)
          res.end('Proxy error')
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), hordeImageProxy()],
  server: {
    proxy: {
      '/horde-api': {
        target: 'https://stablehorde.net',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/horde-api/, '/api/v2'),
      },
    },
  },
})
