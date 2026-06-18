export type PlayerAction =
  | 'move' | 'jump' | 'walljump' | 'dash' | 'dive'
  | 'stomp' | 'pickup' | 'placeBlock';

export interface TutorialStep {
  id: string;
  message: string;
  advanceOn: 'tap' | PlayerAction;
  mode: 'info' | 'hint';
}

export interface TutorialCallbacks {
  onStepEnter(step: TutorialStep): void;
  onComplete(): void;
}

/** Pure, Phaser-agnostic step machine. The scene reacts to onStepEnter (keyed by
 *  step.id for side effects, step.mode for overlay style) and onComplete. */
export class TutorialDirector {
  private index = -1;
  private done = false;

  constructor(
    private readonly steps: TutorialStep[],
    private readonly callbacks: TutorialCallbacks,
  ) {}

  get currentStep(): TutorialStep | null {
    return this.index >= 0 && this.index < this.steps.length ? this.steps[this.index] : null;
  }

  start(): void {
    if (this.done) return;
    this.index = 0;
    this.enterCurrentOrComplete();
  }

  tapNext(): void {
    const step = this.currentStep;
    if (this.done || !step || step.advanceOn !== 'tap') return;
    this.advance();
  }

  notify(action: PlayerAction): void {
    const step = this.currentStep;
    if (this.done || !step || step.advanceOn !== action) return;
    this.advance();
  }

  skip(): void {
    if (this.done) return;
    this.complete();
  }

  private advance(): void {
    this.index += 1;
    this.enterCurrentOrComplete();
  }

  private enterCurrentOrComplete(): void {
    const step = this.currentStep;
    if (step) this.callbacks.onStepEnter(step);
    else this.complete();
  }

  private complete(): void {
    if (this.done) return;
    this.done = true;
    this.callbacks.onComplete();
  }
}
