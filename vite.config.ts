import { defineConfig } from 'vite';

// PORT lets parallel agents (one git worktree each) run dev servers side by side.
const port = Number(process.env.PORT ?? 5188);

export default defineConfig({
  // Relative base, so dist/ works from any static-host sub-path; runtime asset URLs go through assetUrl().
  base: './',
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
    // Maps are written but not referenced from the shipped JS. Don't deploy *.map.
    sourcemap: 'hidden',
    chunkSizeWarningLimit: 900,
    // three.js gets its own vendor chunk: it keeps the game chunk under the size limit and caches across releases.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]/ }],
        },
      },
    },
    // lightningcss drops `translate:` when the same rule also sets `transform:`, so don't combine them.
  },
});
