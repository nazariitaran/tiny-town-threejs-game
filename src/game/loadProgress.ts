/**
 * Boot progress in a few player-facing stages. Stages load in parallel, so the label is the first
 * unfinished stage in display order: it only ever moves forward, however the downloads finish.
 */
export type LoadStage = 'models' | 'townsfolk' | 'scene';

/** Display order and the loading screen's copy for each stage. */
export const LOAD_STAGES: readonly { id: LoadStage; label: string }[] = [
  { id: 'models', label: 'Gathering roads, houses and trees…' },
  { id: 'townsfolk', label: 'Waking up the townsfolk…' },
  { id: 'scene', label: 'Setting the scene…' },
];

export interface LoadProgressReport {
  loaded: number;
  total: number;
  label: string;
}

export class LoadProgress {
  private readonly loaded = new Map<LoadStage, number>();
  private readonly total: number;

  /** `counts`: work items per stage (files, or 1 for a step). */
  constructor(
    private readonly counts: Readonly<Record<LoadStage, number>>,
    private readonly onChange: (report: LoadProgressReport) => void,
  ) {
    this.total = LOAD_STAGES.reduce((sum, { id }) => sum + counts[id], 0);
    for (const { id } of LOAD_STAGES) this.loaded.set(id, 0);
  }

  /** Marks `count` more items of `stage` done (clamped to the stage's count) and reports. */
  advance(stage: LoadStage, count = 1): void {
    this.loaded.set(stage, Math.min(this.counts[stage], this.loaded.get(stage)! + count));
    this.report();
  }

  report(): void {
    this.onChange(this.snapshot());
  }

  snapshot(): LoadProgressReport {
    let loaded = 0;
    for (const done of this.loaded.values()) loaded += done;
    const current = LOAD_STAGES.find(({ id }) => this.loaded.get(id)! < this.counts[id]) ?? LOAD_STAGES[LOAD_STAGES.length - 1];
    return { loaded, total: this.total, label: current.label };
  }
}
