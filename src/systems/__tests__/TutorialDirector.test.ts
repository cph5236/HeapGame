import { describe, it, expect, vi } from 'vitest';
import { TutorialDirector, type TutorialStep } from '../TutorialDirector';

const steps: TutorialStep[] = [
  { id: 'welcome', message: 'hi',   advanceOn: 'tap',  mode: 'info' },
  { id: 'jump',    message: 'jump', advanceOn: 'jump', mode: 'hint' },
  { id: 'done',    message: 'bye',  advanceOn: 'tap',  mode: 'info' },
];

function make() {
  const onStepEnter = vi.fn();
  const onComplete = vi.fn();
  const d = new TutorialDirector(steps, { onStepEnter, onComplete });
  return { d, onStepEnter, onComplete };
}

describe('TutorialDirector', () => {
  it('fires onStepEnter for step 0 on start', () => {
    const { d, onStepEnter } = make();
    d.start();
    expect(onStepEnter).toHaveBeenCalledTimes(1);
    expect(onStepEnter).toHaveBeenLastCalledWith(steps[0]);
  });

  it('tapNext advances a tap-gated step', () => {
    const { d, onStepEnter } = make();
    d.start();
    d.tapNext();
    expect(onStepEnter).toHaveBeenLastCalledWith(steps[1]);
  });

  it('tapNext does nothing on an action-gated step', () => {
    const { d, onStepEnter } = make();
    d.start();
    d.tapNext();                 // now on 'jump' (action-gated)
    d.tapNext();                 // should be ignored
    expect(onStepEnter).toHaveBeenLastCalledWith(steps[1]);
  });

  it('notify advances only on the matching action', () => {
    const { d, onStepEnter } = make();
    d.start();
    d.tapNext();                 // on 'jump'
    d.notify('dash');            // wrong action — ignored
    expect(onStepEnter).toHaveBeenLastCalledWith(steps[1]);
    d.notify('jump');            // correct
    expect(onStepEnter).toHaveBeenLastCalledWith(steps[2]);
  });

  it('completes after the last step', () => {
    const { d, onComplete } = make();
    d.start();
    d.tapNext();                 // -> jump
    d.notify('jump');            // -> done
    d.tapNext();                 // -> complete
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('skip jumps straight to complete', () => {
    const { d, onComplete } = make();
    d.start();
    d.skip();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('notify after completion is a no-op', () => {
    const { d, onComplete } = make();
    d.start();
    d.skip();
    d.notify('jump');
    d.tapNext();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
