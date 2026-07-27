import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  platform: 'node',
  external: ['@nestjs/common', '@nestjs/core', '@axis-iam/vertex', '@axis-iam/vertex/server', 'reflect-metadata'],
})
