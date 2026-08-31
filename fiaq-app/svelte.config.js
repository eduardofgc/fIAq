import adapterVercel from '@sveltejs/adapter-vercel'
import adapterNode from '@sveltejs/adapter-node'
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

// DEPLOY_TARGET=node gera build standalone (Docker/self-host); padrão continua Vercel
const adapter =
  process.env.DEPLOY_TARGET === 'node'
    ? adapterNode()
    : adapterVercel({
        runtime: 'nodejs22.x',
        maxDuration: 60
      })

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter,
    files: {
      assets: 'public'
    },
    alias: {
      '@/*': './src/lib/*',
      '~/*': './src/lib/*',
      '~~/*': './*'
    }
  }
}

export default config
