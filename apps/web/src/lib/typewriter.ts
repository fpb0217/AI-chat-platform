export interface FrameScheduler {
  now(): number;
  request(callback: (timestamp: number) => void): number;
  cancel(id: number): void;
}

const browserScheduler: FrameScheduler = {
  now: () => performance.now(),
  request: (callback) => requestAnimationFrame(callback),
  cancel: (id) => cancelAnimationFrame(id),
};

export function splitGraphemes(text: string): string[] {
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(segmenter.segment(text), (entry) => entry.segment);
  }
  return Array.from(text);
}

export function speedForBacklog(backlog: number): number {
  const baseSpeed = 48;
  const maximumSpeed = 240;
  if (backlog <= 24) {
    return baseSpeed;
  }
  if (backlog >= 240) {
    return maximumSpeed;
  }
  const progress = (backlog - 24) / (240 - 24);
  return baseSpeed + (maximumSpeed - baseSpeed) * progress;
}

export class TypewriterBuffer {
  private readonly pending: string[] = [];
  private frameId: number | null = null;
  private lastTimestamp: number | null = null;
  private credit = 0;
  private finishDeadline: number | null = null;
  private finishResolvers: Array<() => void> = [];
  private disposed = false;

  public constructor(
    private readonly onAppend: (text: string) => void,
    private readonly scheduler: FrameScheduler = browserScheduler,
  ) {}

  push(text: string): void {
    if (this.disposed || text.length === 0) {
      return;
    }
    this.pending.push(...splitGraphemes(text));
    this.schedule();
  }

  finish(maximumDrainMs = 300): Promise<void> {
    if (this.pending.length === 0) {
      return Promise.resolve();
    }
    this.finishDeadline = this.scheduler.now() + maximumDrainMs;
    this.schedule();
    return new Promise((resolve) => {
      this.finishResolvers.push(resolve);
    });
  }

  flush(): void {
    if (this.pending.length > 0) {
      this.onAppend(this.pending.splice(0).join(""));
    }
    this.resolveFinished();
  }

  dispose(): void {
    this.disposed = true;
    if (this.frameId !== null) {
      this.scheduler.cancel(this.frameId);
      this.frameId = null;
    }
    this.pending.length = 0;
    this.resolveFinished();
  }

  private schedule(): void {
    if (this.frameId === null && !this.disposed && this.pending.length > 0) {
      this.frameId = this.scheduler.request((timestamp) => this.tick(timestamp));
    }
  }

  private tick(timestamp: number): void {
    this.frameId = null;
    if (this.disposed || this.pending.length === 0) {
      this.resolveFinished();
      return;
    }

    const elapsed = Math.min(
      100,
      Math.max(0, timestamp - (this.lastTimestamp ?? timestamp - 16.67)),
    );
    this.lastTimestamp = timestamp;
    let take = 0;

    if (this.finishDeadline !== null) {
      if (timestamp >= this.finishDeadline) {
        take = this.pending.length;
      } else {
        const remaining = Math.max(1, this.finishDeadline - timestamp);
        take = Math.max(
          1,
          Math.ceil(this.pending.length * Math.min(1, elapsed / remaining)),
        );
      }
    } else {
      this.credit += (speedForBacklog(this.pending.length) * elapsed) / 1_000;
      take = Math.floor(this.credit);
      this.credit -= take;
    }

    if (take > 0) {
      this.onAppend(this.pending.splice(0, take).join(""));
    }

    if (this.pending.length === 0) {
      this.lastTimestamp = null;
      this.credit = 0;
      this.resolveFinished();
      return;
    }
    this.schedule();
  }

  private resolveFinished(): void {
    this.finishDeadline = null;
    for (const resolve of this.finishResolvers.splice(0)) {
      resolve();
    }
  }
}

