import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'served-build-launch-guidance',
      apply: 'build',
      transformIndexHtml(html) {
        // A served live build must never silently redirect to synthetic data.
        return html
          .replace(/<!-- source-file-launch:start -->[\s\S]*?<!-- source-file-launch:end -->/, '')
          .replace('href="./TerraVigil-preview.html"', 'href="../TerraVigil-preview.html"');
      },
    },
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
