/**
 * Top-left stats cluster (WP-06): fixed-width tabular numerals that count up/down to the
 * latest `town:stats` value and "punch" when a value changes. One rAF loop runs only while a
 * counter is moving; nothing allocates per frame.
 */
import type { TownStats } from '../town/types';
import { GLYPHS } from './glyphs';

type StatKey = 'homes' | 'residents' | 'trees' | 'roadTiles';

const STATS: ReadonlyArray<{ key: StatKey; label: string; glyph: keyof typeof GLYPHS }> = [
  { key: 'homes', label: 'Homes', glyph: 'homes' },
  { key: 'residents', label: 'Residents', glyph: 'residents' },
  { key: 'trees', label: 'Trees', glyph: 'trees' },
  { key: 'roadTiles', label: 'Roads', glyph: 'roads' },
];

const COUNT_MS = 450;

interface Counter {
  el: HTMLElement;
  num: HTMLElement;
  from: number;
  to: number;
  shown: number;
  start: number;
}

export class StatsHud {
  readonly element: HTMLElement;
  private readonly counters: Counter[] = [];
  private raf = 0;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'ui-stats ui-pill';
    this.element.id = 'ui-stats';
    this.element.setAttribute('role', 'status');
    this.element.setAttribute('aria-label', 'Town stats');
    this.element.innerHTML = STATS.map(
      (s) => `<span class="ui-stat" data-stat="${s.key}" title="${s.label}">${GLYPHS[s.glyph]}<b class="ui-stat-num">0</b><span class="ui-stat-label">${s.label}</span></span>`,
    ).join('');
    for (const el of this.element.querySelectorAll<HTMLElement>('.ui-stat')) {
      const num = el.querySelector<HTMLElement>('.ui-stat-num')!;
      this.counters.push({ el, num, from: 0, to: 0, shown: 0, start: 0 });
      num.addEventListener('animationend', () => el.classList.remove('is-punch', 'is-down'));
    }
  }

  /** `animate` false = snap (first paint). */
  set(stats: TownStats, animate = true): void {
    const now = performance.now();
    STATS.forEach((s, i) => {
      const c = this.counters[i];
      const value = stats[s.key];
      if (value === c.to) return;
      const up = value > c.to;
      c.from = c.shown;
      c.to = value;
      c.start = now;
      if (!animate || this.reducedMotion.matches) {
        c.shown = value;
        c.num.textContent = String(value);
        return;
      }
      // Restart the punch animation even if it is mid-flight.
      c.el.classList.remove('is-punch', 'is-down');
      void c.el.offsetWidth;
      c.el.classList.add('is-punch');
      if (!up) c.el.classList.add('is-down');
    });
    if (!this.raf && this.counters.some((c) => c.shown !== c.to)) this.raf = requestAnimationFrame(this.tick);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private readonly tick = (now: number): void => {
    let moving = false;
    for (const c of this.counters) {
      if (c.shown === c.to) continue;
      const t = Math.min(1, (now - c.start) / COUNT_MS);
      const eased = 1 - (1 - t) ** 3;
      const next = t >= 1 ? c.to : Math.round(c.from + (c.to - c.from) * eased);
      if (next !== c.shown) {
        c.shown = next;
        c.num.textContent = String(next);
      }
      if (c.shown !== c.to) moving = true;
    }
    this.raf = moving ? requestAnimationFrame(this.tick) : 0;
  };
}
