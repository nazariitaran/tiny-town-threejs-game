import { describe, expect, it } from 'vitest';
import { LOAD_STAGES, LoadProgress, type LoadProgressReport } from './loadProgress';

const label = (id: string): string => LOAD_STAGES.find((stage) => stage.id === id)!.label;

function track(): { progress: LoadProgress; reports: LoadProgressReport[] } {
  const reports: LoadProgressReport[] = [];
  const progress = new LoadProgress({ models: 3, townsfolk: 2, scene: 1 }, (report) => reports.push(report));
  return { progress, reports };
}

describe('LoadProgress', () => {
  it('starts on the first stage with nothing loaded', () => {
    const { progress } = track();
    expect(progress.snapshot()).toEqual({ loaded: 0, total: 6, label: label('models') });
  });

  it('keeps the earliest unfinished stage while a later one finishes first', () => {
    const { progress, reports } = track();
    progress.advance('townsfolk', 2);
    progress.advance('models');
    expect(reports.map((r) => r.label)).toEqual([label('models'), label('models')]);
    expect(reports.at(-1)!.loaded).toBe(3);
    progress.advance('models', 2);
    expect(reports.at(-1)!.label).toBe(label('scene'));
  });

  it('labels only move forward and the count reaches the total', () => {
    const { progress, reports } = track();
    progress.advance('models', 3);
    progress.advance('townsfolk');
    progress.advance('townsfolk');
    progress.advance('scene');
    const order = reports.map((r) => LOAD_STAGES.findIndex((stage) => stage.label === r.label));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(reports.at(-1)).toEqual({ loaded: 6, total: 6, label: label('scene') });
  });

  it('clamps a stage at its count', () => {
    const { progress } = track();
    progress.advance('models', 10);
    expect(progress.snapshot().loaded).toBe(3);
  });
});
