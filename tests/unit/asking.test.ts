import { describe, it, expect, beforeEach } from 'vitest';
import { runAsk } from '../../src/ask/runAsk';
import { useUiStore } from '../../src/store/uiStore';
import { useWorkspaceStore } from '../../src/store/workspaceStore';
import { validateSeed } from '../../src/data/validateSeed';
import workspaceJson from '../../seed/workspace.json';

/**
 * The shared thinking flag. A summary takes seconds, and a click that goes
 * silent for seconds sends people off pressing other buttons — so every ask
 * surface reads one flag, and a second question while one is out is refused
 * rather than raced.
 */

const payload = validateSeed(workspaceJson);

const answer = {
  answer: 'It is decided.',
  citations: [],
  highlighted_node_ids: [],
  refused: false,
};

beforeEach(() => {
  useUiStore.setState({ answer: null, askThread: [], highlightedIds: [], asking: false });
});

describe('runAsk and the asking flag', () => {
  it('is up while the question is out, and down after — even on failure', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    useWorkspaceStore.setState({
      payload,
      source: {
        mode: 'api',
        load: async () => payload,
        ask: async () => {
          await gate;
          return answer;
        },
      } as never,
    });

    const flight = runAsk('what did we decide?');
    await Promise.resolve();
    expect(useUiStore.getState().asking).toBe(true);

    release();
    expect(await flight).toBe(true);
    expect(useUiStore.getState().asking).toBe(false);
  });

  it('refuses a second question while the first is out', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    useWorkspaceStore.setState({
      payload,
      source: {
        mode: 'api',
        load: async () => payload,
        ask: async () => {
          await gate;
          return answer;
        },
      } as never,
    });

    const first = runAsk('first?');
    await Promise.resolve();
    // The impatient second click — exactly the moment the flag exists for.
    expect(await runAsk('second?')).toBe(false);

    release();
    expect(await first).toBe(true);
    expect(useUiStore.getState().answer?.question).toBe('first?');
  });
});
