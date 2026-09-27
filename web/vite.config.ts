import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
// Two separate entry points: the owner app and the prospect-safe demo never share a bundle (spec Y15).
export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { input: { app: resolve(__dirname, 'index.html'), demo: resolve(__dirname, 'demo.html') } } },
  server: { proxy: { '/api': 'http://127.0.0.1:3000', '/media': 'http://127.0.0.1:3000' } },
});
