import { defineConfig } from 'vite';

// PORT lets parallel agents (one git worktree each) run dev servers side by side.
const port = Number(process.env.PORT ?? 5188);

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: port - 1000,
    strictPort: true,
  },
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
});
