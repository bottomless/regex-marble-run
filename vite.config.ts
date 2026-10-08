import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  server: {
    host: process.env.HOST ?? '127.0.0.1',
    port: Number(process.env.PORT ?? 5173),
    strictPort: true,
    allowedHosts: true,
  },
  preview: {
    host: process.env.HOST ?? '127.0.0.1',
    port: Number(process.env.PORT ?? 4173),
    strictPort: true,
    allowedHosts: true,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three/')) return 'three';
          if (id.includes('node_modules/@react-three/')) return 'r3f';
          if (id.includes('node_modules/react')) return 'react';
        },
      },
    },
  },
});
