import { resolve } from 'path'
import { realpathSync } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Vite resolves index.html to its real path. When the project is reached through a
// redirected folder (e.g. Windows app-data virtualisation) the root must be the real
// path too, otherwise the emitted HTML name becomes "../../..." and the build fails.
// Only the native realpath (GetFinalPathNameByHandle) sees through such redirects.
const rendererRoot = realpathSync.native(resolve('src/renderer'))

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@llmTypes': resolve('src/main/llmProviders/types.ts')
      }
    },
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main'
    }
  },
  preload: {
    resolve: {
      alias: {
        '@llmTypes': resolve('src/main/llmProviders/types.ts')
      }
    },
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload'
    }
  },
  renderer: {
    root: rendererRoot,
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@llmTypes': resolve('src/main/llmProviders/types.ts')
      }
    },
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: resolve(rendererRoot, 'index.html')
      }
    },
    plugins: [react()],
    server: {
      watch: {
        usePolling: true
      }
    }
  }
})
