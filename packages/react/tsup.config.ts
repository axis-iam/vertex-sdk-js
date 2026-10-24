import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    external: ['react', 'react-dom', '@axis-iam/vertex'],
    treeshake: true,
    splitting: false,
    esbuildOptions(options) {
      options.jsx = 'automatic'
    },
  },
])
