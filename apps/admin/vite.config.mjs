import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const proxy = { '/api': { target: process.env.ADMIN_API_TARGET || 'http://127.0.0.1:3114', changeOrigin: true } };
export default defineConfig({ plugins: [react()], server: { proxy }, preview: { proxy } });
