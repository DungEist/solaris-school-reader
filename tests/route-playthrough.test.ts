import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import test from 'node:test';
import { DialogueBacklog } from '../src/ui/DialogueBacklog.ts';
import { evaluateConditionGroup } from '../src/engine/StoryState.ts';
import { eligibleQuestNodes } from '../src/engine/StoryProgress.ts';
import type { RunnerEvent } from '../src/engine/types.ts';
import { playthroughHarness, realCatalog, realSource } from './PlaythroughHarness.ts';

const reports: unknown[] = [];
function report(value: unknown): void {
  reports.push(value);
  writeFileSync(new URL('../test-results/phase8-real-route-tests.json', import.meta.url), JSON.stringify(reports, null, 2));
}
const at = (h: ReturnType<typeof playthroughHarness>, script: string, node: number) => h.runner.getSnapshot().scriptId === script && h.runner.getSnapshot().nid === node;
const controlledRoute = { choices: { '1034/27': 26, '8024/13': 10, '8025/5': 2 }, visit: false } as const;

test('the same 1011 checkpoint changes a real later Chisa relationship decision', async () => {
  const h = playthroughHarness(1), evidence: unknown[] = [];
  try {
    assert.equal(await h.start(), true);
    await h.until(() => at(h, '1011', 8));
    const checkpoint = h.journey.createCheckpoint(); assert.ok(checkpoint);
    for (const optionId of [2, 3]) {
      assert.equal(await h.journey.restoreCheckpoint(checkpoint), true);
      const choice = h.runner.getSnapshot();
      assert.equal(h.runner.choose(choice.choices.findIndex(o => o.optionId === optionId), choice), true);
      assert.equal(h.runner.getSnapshot().nid, optionId === 2 ? 9 : 10);
      await h.until(() => at(h, '1011', 11), controlledRoute);
      assert.equal(h.runner.getSnapshot().storyState.favor['11'].points, optionId === 2 ? 0 : 5);
      await h.until(() => h.journey.getSnapshot().dayIndex === 9 && h.journey.getSnapshot().phase === 'planning'
        && h.journey.getSnapshot().options.some(o => o.id === 'behavior:6010' && o.condition.value === 'true'), controlledRoute);
      assert.equal(await h.journey.select('behavior:6010'), true);
      await h.until(() => h.runner.getSnapshot().storyState.behaviors['6010']?.count === 1, controlledRoute);
      assert.equal(h.runner.getSnapshot().storyState.favor['11'].points, optionId === 2 ? 20 : 25);
      await h.until(() => h.journey.getSnapshot().dayIndex === 213 && h.journey.getSnapshot().phase === 'planning', controlledRoute);
      const before = h.runner.getSnapshot().storyState, eligible = eligibleQuestNodes(before, realSource, 1, 1009).nodes.some(n => n.Id === 112141);
      assert.equal(before.favor['11'].level, 1);
      assert.equal(before.favor['11'].points, optionId === 2 ? 25 : 30);
      assert.equal(evaluateConditionGroup(26100028, before, realSource).value, optionId === 2 ? 'false' : 'true');
      assert.equal(eligible, optionId === 3);
      assert.equal(await h.journey.select('location:1009'), true);
      if (optionId === 3) {
        await h.until(() => h.runner.getSnapshot().storyState.questNodes['112141'] === true, controlledRoute);
        assert.deepEqual(h.runner.getSnapshot().storyState.favor['11'], { unlocked: true, level: 2, points: 0 });
        assert.ok(h.runner.getSnapshot().storyState.flowReads['6001'] > 0);
      } else {
        assert.equal(h.runner.getSnapshot().storyState.questNodes['112141'], undefined);
        assert.deepEqual(h.runner.getSnapshot().storyState.favor['11'], before.favor['11']);
      }
      evidence.push({ script: '1011', node: 8, option: optionId, destination: optionId === 2 ? 9 : 10, rejoin: 11,
        commonSocial: { behavior: 6010, day: 9, count: 1 }, birthday: { day: 212, location: 1087, choices: { '8024/13': 10, '8025/5': 2 } },
        later: { day: 213, location: 1009, node: 112141, condition: 26100028, eligible, before: before.favor['11'], after: h.runner.getSnapshot().storyState.favor['11'] } });
    }
    report({ test: 'normal checkpoint consequences and later decision', evidence });
  } finally { h.dispose(); }
});

test('real request completion confirms before rewards and inventory receipts survive History and checkpoint reads', async () => {
  const h = playthroughHarness(2), history = new DialogueBacklog(h.runner), grants: Extract<RunnerEvent, { type: 'storyMutation' }>[] = [];
  history.setTextContext(realCatalog.english, realCatalog.speakers, { playerName: 'Rover', gender: 'male' });
  h.runner.onEvent(e => { if (e.type === 'storyMutation') grants.push(e); });
  const rewardChanges = () => grants.flatMap(e => e.changes).filter(c => c.rewardGroupId === 9001101);
  try {
    assert.equal(await h.start(), true);
    await h.until(() => h.journey.getSnapshot().interaction?.kind === 'requestDone' && h.journey.getSnapshot().interaction?.sourceId === 1101,
      { accept: 1101, behavior: 1101 });
    const completed = h.runner.getSnapshot().storyState, request = completed.behaviors['1101'];
    assert.equal(request.state, 'Finished'); assert.equal(request.count, 6); assert.equal(request.acceptedDay, 30);
    assert.equal(request.finishDeadline, 55); assert.deepEqual(request.workDays, [46, 47, 48, 53, 54, 55]);
    assert.ok(completed.flowReads['13102'] > 0, 'The authored finish dialogue completes before confirmation.');
    assert.equal(rewardChanges().length, 0);
    const before = completed.attributes;
    await h.journey.dismissInteraction(); await h.journey.flush();
    const rewarded = h.runner.getSnapshot().storyState;
    assert.equal(rewarded.attributes['1'], before['1'] + 8); assert.equal(rewarded.attributes['2'], before['2'] + 8);
    assert.deepEqual(rewardChanges().map(c => [c.rewardId, c.attributeId, c.value]), [[900110101, 1, 8], [900110102, 2, 8]]);
    const itemGrants = grants.flatMap(e => e.changes.filter(c => c.kind === 'item').map(c => ({ script: e.scriptId, item: c.itemId, action: e.actionId, reward: c.rewardId, value: c.value })));
    for (const [script, item, action] of [['1010', 49, 103090], ['1010', 30, 106042], ['1009', 40, 103081]]) {
      assert.equal(itemGrants.filter(c => c.script === script && c.item === item && c.action === action).length, 1);
      assert.equal(rewarded.items[String(item)].min, 1);
    }
    const checkpoint = h.journey.createCheckpoint(); assert.ok(checkpoint);
    const count = grants.length;
    for (let repeat = 0; repeat < 3; repeat++) {
      history.getSnapshot(); h.runner.getSnapshot(); h.journey.getSnapshot();
      history.setTextContext(realCatalog.english, realCatalog.speakers, { playerName: 'Rover', gender: 'male' });
      assert.equal(await h.journey.restoreCheckpoint(checkpoint), true);
      assert.deepEqual(h.runner.getSnapshot().storyState, rewarded);
    }
    assert.equal(grants.length, count); assert.equal(rewardChanges().length, 2);
    report({ test: 'real request and item reward timing and replay safety', request: 1101, acceptedDay: request.acceptedDay, count: request.count,
      deadline: request.finishDeadline, workDays: request.workDays, finishScript: '13102', rewardGroup: 9001101, rewards: rewardChanges().map(c => c.rewardId), items: itemGrants });
  } finally { history.dispose(); h.dispose(); }
});

test('normal live map access opens stocked shops and a real purchase deducts its cost once', async () => {
  const h = playthroughHarness(1), receipts: Extract<RunnerEvent, { type: 'storyMutation' }>[] = [];
  h.runner.onEvent(e => { if (e.type === 'storyMutation') receipts.push(e); });
  try {
    assert.equal(await h.start(), true);
    await h.until(() => h.journey.getSnapshot().dayIndex === 12 && h.journey.getSnapshot().timeSlot === 4 && h.journey.getSnapshot().phase === 'planning');
    assert.equal(await h.journey.select('location:1010'), true);
    assert.equal(await h.journey.select('locationOption:401'), true);
    assert.equal(h.journey.getSnapshot().interaction?.kind, 'shop');
    const option = h.journey.getSnapshot().options.find(o => o.kind === 'shopItem' && o.contextId === 2 && o.condition.value === 'true');
    assert.ok(option, 'The source-unlocked location must expose its actual gift stock.');
    const before = h.runner.getSnapshot().storyState, goods = realSource.shopGoods?.[String(option.sourceId)], item = String(goods?.ItemId);
    assert.ok(goods); assert.ok(option.price !== null && option.price !== undefined);
    assert.equal(await h.journey.select(option.id), true);
    const bought = h.runner.getSnapshot().storyState;
    assert.equal(bought.attributes['8'], before.attributes['8'] - option.price);
    assert.equal(bought.items[item].min, before.items[item].min + 1);
    assert.equal(await h.journey.select(option.id), false, 'Sold-out stock cannot charge or grant again.');
    await h.journey.dismissInteraction();
    const checkpoint = h.journey.createCheckpoint(); assert.ok(checkpoint);
    const count = receipts.length;
    assert.equal(await h.journey.restoreCheckpoint(checkpoint), true);
    assert.deepEqual(h.runner.getSnapshot().storyState.items, bought.items);
    assert.equal(receipts.length, count);
    report({ test: 'normal stocked shop purchase and replay safety', day: 12, location: 1010, option: 401, purchase: option.id, item: Number(item), price: option.price });
  } finally { h.dispose(); }
});
