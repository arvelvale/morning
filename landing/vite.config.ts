import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // 发布到 GitHub Pages 时由 deploy/publish_site.py 设成 /morning-site/
  base: process.env.VITE_SITE_BASE || '/',
  build: { outDir: 'dist' },
});
