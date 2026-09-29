import { defineConfig } from 'vite';

// PORT lets parallel agents (one git worktree each) run dev servers side by side.
const port = Number(process.env.PORT ?? 5188);

export default defineConfig({
  // Relative base (WP-11): the built dist/ works from any static-host sub-path
  // (e.g. GitHub Pages https://<user>.github.io/<repo>/). Runtime asset URLs go through
  // assetUrl() in src/game/config.ts, which prefixes import.meta.env.BASE_URL ('./').
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
    // 'hidden': maps are still written for debugging crash reports, but the shipped JS carries
    // no sourceMappingURL comment, so players' browsers never fetch them. Don't deploy *.map.
    sourcemap: 'hidden',
    chunkSizeWarningLimit: 900,
    // three.js (and its addons) in their own vendor chunk (WP-20): the game's own code had grown to the
    // 900 kB warning limit with three.js inside it. The split changes no download size; three.js also
    // caches across game releases. PhotoFrame stays a separate lazy chunk.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]/ }],
        },
      },
    },
    // CSS minification (lightningcss) is on. Caution: lightningcss 1.32 drops an individual
    // `translate:` property when the same rule also sets `transform:`. That once de-centred .ui-hint
    // in production only, so don't combine them. Keep running the visual baselines against `vite preview`.
  },
});
