import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import test from 'node:test';
import { DialogueBacklog } from '../src/ui/DialogueBacklog.ts';
import { initialStoryState } from '../src/engine/StoryState.ts';
import type { RunnerEvent } from '../src/engine/types.ts';
import { playthroughHarness, realCatalog, realSource } from './PlaythroughHarness.ts';

const reports: unknown[] = [];
function report(value: unknown): void {
  reports.push(value);
  writeFileSync(new URL('../test-results/phase8-normal-playthrough-tests.json', import.meta.url), JSON.stringify(reports, null, 2));
}
const at = (h: ReturnType<typeof playthroughHarness>, script: string, node: number) => h.runner.getSnapshot().scriptId === script && h.runner.getSnapshot().nid === node;
const favor = (h: ReturnType<typeof playthroughHarness>) => h.runner.getSnapshot().storyState.favor['11'];

test('normal Reader forks 1011/8 with authored favor, replay safety, and a fresh initial state', async () => {
  const h = playthroughHarness(1), history = new DialogueBacklog(h.runner);
  history.setTextContext(realCatalog.english, realCatalog.speakers, { playerName: 'Rover', gender: 'male' });
  const mutations: Extract<RunnerEvent, { type: 'storyMutation' }>[] = [];
  h.runner.onEvent(event => { if (event.type === 'storyMutation') mutations.push(event); });
  const unsubscribeReads = h.runner.subscribe(() => { history.getSnapshot(); h.runner.getSnapshot(); h.journey.getSnapshot(); });
  const evidence: unknown[] = [];
  try {
    assert.equal(await h.start(), true);
    assert.deepEqual(h.runner.getSnapshot().storyState.attributes, initialStoryState(realSource).attributes);
    await h.until(() => at(h, '1011', 8));
    assert.equal(h.journey.getSnapshot().dayIndex, 3);
    assert.equal(favor(h).points, 0);
    assert.equal(h.runner.getSnapshot().storyState.items['10'].min, 0);
    const checkpointAttributes = h.runner.getSnapshot().storyState.attributes;
    const checkpoint = h.journey.createCheckpoint();
    assert.ok(checkpoint);
    for (const optionId of [2, 3]) {
      assert.equal(await h.journey.restoreCheckpoint(checkpoint), true);
      const token = h.runner.getSnapshot(), index = token.choices.findIndex(option => option.optionId === optionId);
      assert.ok(index >= 0);
      assert.equal(token.choiceConditions[index].value, 'true');
      const before = mutations.length;
      assert.equal(h.runner.choose(index, token), true);
      assert.equal(h.runner.choose(index, token), false, 'A stale response cannot select twice.');
      assert.equal(h.runner.getSnapshot().nid, optionId === 2 ? 9 : 10);
      assert.equal(favor(h).points, optionId === 2 ? 0 : 5);
      assert.deepEqual(h.runner.getSnapshot().storyState.attributes, checkpointAttributes);
      await h.until(() => at(h, '1011', 11));
      assert.equal(favor(h).points, optionId === 2 ? 0 : 5);
      assert.deepEqual(h.runner.getSnapshot().storyState.attributes, checkpointAttributes);
      const grants = mutations.slice(before).filter(event => event.actionId === 20000224);
      assert.equal(grants.length, optionId === 2 ? 0 : 1);
      if (optionId === 3) assert.deepEqual(grants[0].changes.map(change => [change.rewardGroupId, change.rewardId, change.roleId, change.value]), [[20000229, 20000282, 11, 5]]);

      const joined = h.journey.createCheckpoint();
      assert.ok(joined);
      const joinedState = h.runner.getSnapshot().storyState, mutationCount = mutations.length;
      for (let count = 0; count < 5; count++) {
        history.getSnapshot(); h.runner.getSnapshot(); h.journey.getSnapshot();
        history.setTextContext(realCatalog.english, realCatalog.speakers, { playerName: 'Rover', gender: 'male' });
        await h.journey.flush();
      }
      assert.equal(mutations.length, mutationCount, 'Reading History and snapshots does not replay a grant.');
      assert.equal(h.runner.getSnapshot().storyState, joinedState);
      for (let count = 0; count < 2; count++) {
        assert.equal(await h.journey.restoreCheckpoint(joined), true);
        assert.deepEqual(h.runner.getSnapshot().storyState, joinedState);
      }
      assert.equal(mutations.length, mutationCount, 'Restoring the rejoin checkpoint does not replay a grant.');

      evidence.push({ optionId, immediateNode: optionId === 2 ? 9 : 10, rejoinNode: 11, rejoinFavor: optionId === 2 ? 0 : 5, rewardGroup: optionId === 3 ? 20000229 : null, rewardId: optionId === 3 ? 20000282 : null, staleChoiceIgnored: true, historyAndRestoreDidNotReplay: true });
    }
    assert.equal(await h.start(), true);
    const fresh = h.runner.getSnapshot().storyState;
    assert.equal(fresh.playthroughCount, 1);
    assert.deepEqual(fresh.attributes, initialStoryState(realSource).attributes);
    assert.equal(fresh.favor['11'].points, 0);
    assert.deepEqual(fresh.exams, {});
    assert.deepEqual(fresh.choices, {});
    assert.equal(fresh.items['10'].min, 0);
    report({ test: '1011 normal forks, replay safety, and fresh reset', evidence });
  } finally { unsubscribeReads(); history.dispose(); h.dispose(); }
});
