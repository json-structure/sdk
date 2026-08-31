export type ConversionState = 'idle' | 'preparing' | 'running' | 'publishing' | 'launching' | 'completed' | 'cancelled' | 'failed';

const transitions: Readonly<Record<ConversionState, readonly ConversionState[]>> = {
  idle: ['preparing'], preparing: ['running', 'cancelled', 'failed'], running: ['publishing', 'completed', 'cancelled', 'failed'],
  publishing: ['launching', 'completed', 'cancelled', 'failed'], launching: ['completed', 'failed'], completed: [], cancelled: [], failed: [],
};

export class ConversionLifecycle {
  private current: ConversionState = 'idle';
  private readonly history: ConversionState[] = ['idle'];
  get state(): ConversionState { return this.current; }
  get states(): readonly ConversionState[] { return this.history; }
  transition(next: ConversionState): void {
    if (!transitions[this.current].includes(next)) throw new Error(`Invalid conversion transition: ${this.current} -> ${next}.`);
    this.current = next;
    this.history.push(next);
  }
}