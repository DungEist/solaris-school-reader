import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import test from 'node:test';
import { applyActivityAction, evaluateConditionGroup, favorCap, favorLevelRow, initialStoryState, resolveHiddenBranch } from '../src/engine/StoryState.ts';
import { freezeEndingState, nextEndingAction } from '../src/engine/StoryProgress.ts';
import { eligibleQuestNodes } from '../src/engine/StoryProgress.ts';
import { giftEligibility, giftFavorValue, shopRefreshContext } from '../src/engine/StoryItems.ts';
import type { ScriptOption } from '../src/engine/types.ts';
import { playthroughHarness, realScript, realSource } from './PlaythroughHarness.ts';
import type { PlaythroughPolicy } from './PlaythroughHarness.ts';
import { currentJourneyDecision } from '../src/ui/JourneyDecision.ts';

test('the real ending graph executes both owned-medal checks in authored order with live inventory', () => {
  const fresh = initialStoryState(realSource), snapshot = freezeEndingState({ ...fresh, attributes: { ...fresh.attributes, '8': 2000000, '6': 50000 } }, realSource);
  assert.equal(nextEndingAction(snapshot, realSource, 80).path.includes(81), false, 'Statistics alone cannot replace the authored medal receipt.');
  const received = applyActivityAction(applyActivityAction(snapshot, 3511, realSource).state, 3512, realSource).state;
  const changed = { ...received, attributes: { ...fresh.attributes, '8': 0, '6': 0 } };
  const money = nextEndingAction(changed, realSource, 80);
  assert.deepEqual(money.path, [80, 81]); assert.deepEqual(money.actions, [3044]); assert.equal(money.nextNode, 82);
  const popularity = nextEndingAction(changed, realSource, money.nextNode);
  assert.deepEqual(popularity.path, [82, 83]); assert.deepEqual(popularity.actions, [3045]); assert.equal(popularity.nextNode, 12);
  assert.deepEqual(money.unresolved, []); assert.deepEqual(popularity.unresolved, []);
  assert.equal(nextEndingAction({ ...changed, items: fresh.items }, realSource, 80).path.includes(81), false, 'Inventory remains live after the ending snapshot.');
});

test('normal cycles complete graduation, collect all mementos, inherit hidden routes, and achieve the true ending', async () => {
  const h = playthroughHarness(3), cycles: unknown[] = [], hidden: { cycle: number; script: string; node: number; option: number | null; override: boolean }[] = [];
  const mementos: { cycle: number; script: string; item: unknown; action: number; value: unknown }[] = [];
  const endings: { cycle: number; script: string; id: unknown }[] = [];
  const socials = Object.values(realSource.behaviors ?? {}).filter(r => Number(r.BehaviorId) >= 6001 && Number(r.BehaviorId) <= 6010);
  const requiredItems = Array.from({ length: 10 }, (_, i) => String(i + 1));
  const fallback = { '1004/1': 12, '1008/21': 15, '1008/53': 18, '1009/5': 18, '1010/5': 28, '1010/25': 19, '1011/29': 8, '1014/16': 8, '1014/26': 11, '1034/43': 38, '3010/35': 3 };
  const conditioned = { '1004/1': 11, '1008/21': 14, '1008/53': 17, '1009/5': 17, '1010/5': 27, '1010/25': 18, '1011/29': 7, '1014/16': 7, '1014/26': 10, '1034/43': 37 };
  const shopVisits = new Set<string>(), affinityVisits = new Set<string>();
  const decisions: { cycle: number; kind: string; instance: number | null; boundaries: number; actions: string[]; controls: string[]; first: { day: number | null; script: string | null; node: number | null } }[] = [];
  let reportedDay = '';
  h.runner.onEvent(e => {
    const cycle = h.runner.getSnapshot().storyState.playthroughCount ?? 0;
    if (e.type === 'choiceSelected') {
      assert.notEqual(e.entry.debugOverride, true, 'Normal routes must not use a Developer override.');
      if (e.entry.decision === 'automatic') hidden.push({ cycle, script: e.scriptId!, node: e.entry.nid, option: e.entry.optionId, override: !!e.entry.debugOverride });
    }
    if (e.type === 'storyMutation') for (const c of e.changes) {
      if (c.kind === 'item' && requiredItems.includes(String(c.itemId))) mementos.push({ cycle, script: e.scriptId!, item: c.itemId, action: e.actionId, value: c.value });
      if (c.kind === 'endingReached') endings.push({ cycle, script: e.scriptId!, id: c.endingId });
    }
  });
  const policy = (cycle: number): PlaythroughPolicy => {
    const state = h.runner.getSnapshot().storyState, journey = h.journey.getSnapshot();
    const decision = currentJourneyDecision(journey);
    const confirmation = journey.interaction?.kind === 'requestDone' || journey.interaction?.kind === 'requestFailed';
    if (journey.phase === 'planning' || journey.interaction && !confirmation) {
      assert.ok(decision, 'Every ordinary input boundary is projected to the Reader stage.');
      assert.equal(decision.options.length, journey.options.length);
      assert.ok(decision.options.every(option => journey.options.includes(option)), 'All live source options survive the stage projection.');
      if (journey.interaction) assert.equal(decision.options, journey.options, 'Interaction precedence remains authored.');
      else assert.equal(decision.control!.available, journey.canContinue);
      let entry = decisions.find(row => row.cycle === cycle && row.kind === decision.kind && row.instance === journey.instanceId);
      if (!entry) {
        entry = { cycle, kind: decision.kind, instance: journey.instanceId, boundaries: 0, actions: [], controls: [], first: { day: state.dayIndex, script: h.runner.getSnapshot().scriptId, node: h.runner.getSnapshot().nid } };
        decisions.push(entry);
      }
      entry.boundaries++;
      for (const option of decision.options) if (!entry.actions.includes(option.id)) entry.actions.push(option.id);
      if (decision.control?.available && !entry.controls.includes(decision.control.kind)) entry.controls.push(decision.control.kind);
    } else assert.equal(decision, null, 'Dialogue and native confirmations keep their own input timing.');
    const dayKey = `${cycle}:${state.dayIndex}`;
    if (dayKey !== reportedDay && state.dayIndex !== null && state.dayIndex % 20 === 0) {
      reportedDay = dayKey;
      writeFileSync(new URL('../test-results/phase8-final-route-progress.json', import.meta.url), JSON.stringify({ cycle, day: state.dayIndex, script: h.runner.getSnapshot().scriptId, node: h.runner.getSnapshot().nid, scenes: journey.sceneCount, favor: state.favor, gifts: state.gifts, purchases: Object.values(state.shopPurchases).reduce((a, b) => a + b, 0), badges: state.attributes['8'] }, null, 2));
    }
    const choices: Readonly<Record<string, number>> = cycle === 1 ? {} : cycle === 2
      ? { '7038/3': 9 } : { '7038/3': 9, '3011/20': 3, '3011/76': 6, '3011/77': 9 };
    const base = { choices, visit: cycle !== 3 };
    if (cycle === 2) {
      if (journey.interaction?.kind === 'shop') {
        const gift = journey.options.find(o => o.kind === 'shopItem' && o.contextId === 2 && o.condition.value === 'true'
          && socials.some(row => state.favor[String(row.RoleId)]?.level < 4));
        if (gift) return { ...base, option: gift.id };
      }
      if (journey.interaction?.kind === 'gift') {
        const roleId = journey.interaction.sourceId, role = state.favor[String(roleId)], cap = favorCap(realSource, roleId, role.level)!;
        const gift = journey.options.filter(o => o.condition.value === 'true').sort((a, b) =>
          Math.min(cap - role.points, giftFavorValue(b.sourceId, roleId, realSource).value ?? 0)
          - Math.min(cap - role.points, giftFavorValue(a.sourceId, roleId, realSource).value ?? 0))[0];
        if (gift) return { ...base, option: gift.id };
      }
      if (journey.phase === 'planning' && journey.instanceId === 1) {
        const affinity = journey.options.find(o => o.kind === 'location' && o.condition.value === 'true'
          && !affinityVisits.has(`${state.dayIndex}:${o.sourceId}`)
          && eligibleQuestNodes(state, realSource, 1, o.sourceId).nodes.length > 0);
        if (affinity) { affinityVisits.add(`${state.dayIndex}:${affinity.sourceId}`); return { ...base, option: affinity.id }; }
        const gifts = Object.values(realSource.items).filter(item => item.ItemType === 1 && state.items[String(item.Id)]?.min > 0);
        const recipient = socials.map(row => {
          const roleId = Number(row.RoleId), role = state.favor[String(roleId)], cap = role && favorCap(realSource, roleId, role.level);
          const gift = gifts.filter(item => giftEligibility(state, Number(item.Id), roleId, realSource).value === 'true')
            .sort((a, b) => (giftFavorValue(Number(b.Id), roleId, realSource).value ?? 0) - (giftFavorValue(Number(a.Id), roleId, realSource).value ?? 0))[0];
          const option = journey.options.find(o => o.kind === 'locationOption' && o.contextId === roleId && o.sourceId >= 301 && o.sourceId <= 310 && o.condition.value === 'true');
          const remaining = role && cap !== null && cap !== undefined ? cap - role.points + (role.level === 1 ? 150 : role.level === 2 ? 100 : 0) : 0;
          return { gift, option, remaining, value: gift && cap !== null && cap !== undefined ? Math.min(cap - role.points, giftFavorValue(Number(gift.Id), roleId, realSource).value ?? 0) : 0 };
        }).filter(r => r.gift && r.option).sort((a, b) => b.value - a.value || b.remaining - a.remaining)[0];
        if (recipient) return { ...base, option: recipient.option!.id };
        const shop = shopRefreshContext(state, 2, realSource).value;
        if (shop && !shopVisits.has(shop.selectionKey) && state.attributes['8'] >= 4000 && socials.some(row => state.favor[String(row.RoleId)]?.level < 4)) {
          const browse = journey.options.find(o => o.id === 'locationOption:401' && o.condition.value === 'true');
          if (browse) { shopVisits.add(shop.selectionKey); return { ...base, option: browse.id }; }
          if (journey.options.some(o => o.id === 'location:1010' && o.condition.value === 'true')) return { ...base, option: 'location:1010' };
        }
        if (state.attributes['7'] > 40 && journey.options.some(o => o.id === 'behavior:5023' && o.condition.value === 'true')) return { ...base, behavior: 5023 };
        if (state.attributes['8'] < 5000 && journey.options.some(o => o.id === 'behavior:4016' && o.condition.value === 'true')) return { ...base, behavior: 4016 };
      }
    }
    const social = cycle === 2 ? socials.find(row => {
      const role = state.favor[String(row.RoleId)], cap = role ? favorCap(realSource, Number(row.RoleId), role.level) : null;
      const tier = role ? favorLevelRow(realSource, Number(row.RoleId), role.level + 1) : undefined;
      return role?.unlocked && role.level < 4 && cap !== null && role.points < cap
        && evaluateConditionGroup(Number(tier?.PreUnlockConditionId ?? 0), state, realSource).value === 'true'
        && journey.options.some(o => o.id === `behavior:${row.BehaviorId}` && o.condition.value === 'true');
    }) : undefined;
    return { ...base, behavior: social ? Number(social.BehaviorId) : undefined };
  };
  const save = () => {
    writeFileSync(new URL('../test-results/phase8-ending-playthrough-tests.json', import.meta.url), JSON.stringify({ cycles, hidden, mementos, endings }, null, 2));
    writeFileSync(new URL('../test-results/reader-decision-cycles.json', import.meta.url), JSON.stringify({ cycles: cycles.length, decisions }, null, 2));
  };
  try {
    assert.equal(await h.start(), true);
    for (const cycle of [1, 2, 3]) {
      if (cycle > 1) assert.equal(await h.startNextCycle(), true);
      assert.equal(h.runner.getSnapshot().storyState.playthroughCount, cycle);
      if (cycle === 3) for (const id of requiredItems) assert.equal(h.runner.getSnapshot().storyState.items[id].min, 1, 'All Special items are inherited before introductions.');
      const inputs = await h.until(() => h.journey.getSnapshot().phase === 'complete', () => policy(cycle), 80000);
      const state = h.runner.getSnapshot().storyState, journey = h.journey.getSnapshot();
      assert.equal(journey.endingPath[0], 48);
      assert.ok(journey.sceneCount > 70);
      assert.deepEqual(Object.keys(state.examResults), cycle === 1 ? ['1', '2', '3', '5'] : ['1', '2', '3', '4', '5', '6']);
      for (const result of Object.values(state.examResults)) {
        assert.equal(result.score, state.exams[String(result.examId)]);
        const exam = realSource.exams?.[String(result.examId)], band = Object.values(realSource.examScoreRanks ?? {}).find(r => r.GroupId === exam?.ScoreRankGroupId && result.score >= Number(r.ScoreMin) && result.score <= Number(r.ScoreMax));
        assert.ok(band); assert.ok(result.rank >= Math.min(Number(band.RankRandMin), Number(band.RankRandMax)) && result.rank <= Math.max(Number(band.RankRandMin), Number(band.RankRandMax)));
      }
      assert.ok(journey.diagnostics.every(d => d.code === 'quest-priority-tie'), JSON.stringify(journey.diagnostics));
      for (const [id, option] of Object.entries(cycle === 3 ? conditioned : fallback).filter(([id]) => cycle !== 1 || id !== '3010/35')) {
        const choice = hidden.find(c => c.cycle === cycle && `${c.script}/${c.node}` === id);
        assert.ok(choice, `Hidden route ${id} was not visited in cycle ${cycle}.`); assert.equal(choice.option, option);
      }
      if (cycle === 2) {
        assert.equal(state.items['69'].min, 1, 'The second-cycle opening map grants the score that unlocks script3010.');
        assert.ok(state.flowReads['1007'] > 0); assert.ok(state.flowReads['3010'] > 0);
        for (const id of requiredItems) assert.equal(state.items[id].min, 1, `Memento ${id} must be granted by its farewell chain.`);
        for (const row of socials) assert.equal(state.favor[String(row.RoleId)].level, 4);
        assert.equal(state.influences['1'] >= 1 && state.influences['2'] >= 1, true);
        assert.equal(mementos.filter(m => m.cycle === 2).length, 10, 'Each farewell grants its item exactly once.');
      }
      const check = journey.endingPath.indexOf(20); assert.ok(check >= 0);
      assert.equal(evaluateConditionGroup(29000021, state, realSource).value, cycle === 3 ? 'true' : 'false');
      assert.equal(journey.endingPath[check + 1], cycle === 3 ? 47 : 22);
      assert.equal(journey.nextCycle, cycle !== 3);
      const terminalDecision = currentJourneyDecision(journey);
      assert.equal(terminalDecision?.kind ?? null, cycle !== 3 ? 'nextCycle' : null);
      if (terminalDecision) assert.equal(terminalDecision.control!.kind, 'nextCycle', 'The next school year is reachable on stage at the authored terminal.');
      for (const id of Object.keys(state.selectedEndings)) if (state.selectedEndings[id]) assert.equal(state.endings[id], true, 'Achievement follows playback.');
      if (cycle === 3) {
        assert.equal(hidden.find(c => c.cycle === cycle && c.script === '3010' && c.node === 35)?.option, 3, 'The gallery prerequisite is still false before this cycle’s true ending completes.');
        assert.equal(state.variables.key13, true); assert.equal(state.variables.key14, true); assert.equal(state.variables.key15, true);
        assert.ok(state.flowReads['3030'] > 0); assert.equal(state.endings['4'], true);
        const galleryNode = (realScript('3010') as { nodes: { nid: number; options: ScriptOption[] }[] }).nodes.find(n => n.nid === 35);
        assert.ok(galleryNode);
        const gallery = resolveHiddenBranch(galleryNode.options, state, realSource);
        assert.equal(gallery.optionIndex === null ? null : galleryNode.options[gallery.optionIndex].optionId, 2, 'The actual achieved ending resolves the eleventh conditioned hidden route.');
        assert.equal(await h.journey.startNextCycle(), false, 'The authored true ending is a terminal End.');
      }
      cycles.push({ cycle, inputs, day: state.dayIndex, sceneCount: journey.sceneCount, endingPath: journey.endingPath,
        nextCycle: journey.nextCycle, selectedEndings: Object.keys(state.selectedEndings).filter(id => state.selectedEndings[id]),
        favor: state.favor, socialCounts: Object.fromEntries(socials.map(r => [String(r.BehaviorId), state.behaviors[String(r.BehaviorId)]?.count ?? 0])),
        gifts: state.gifts, purchases: state.shopPurchases, economy: { cashier: state.behaviors['4016']?.count ?? 0, rest: state.behaviors['5023']?.count ?? 0 },
        items: Object.fromEntries(requiredItems.map(id => [id, state.items[id].min])), exams: state.examResults, diagnostics: journey.diagnostics });
      save(); console.info(`Normal cycle ${cycle}: ${inputs} inputs, ${journey.sceneCount} scenes, endings ${endings.filter(e => e.cycle === cycle).map(e => e.id).join(',')}`);
    }
    const subsequentOpening = decisions.find(row => row.cycle === 2 && row.instance === 14 && row.kind === 'planning');
    assert.ok(subsequentOpening?.actions.includes('explore:14') && subsequentOpening.actions.includes('location:1155') && subsequentOpening.actions.includes('location:1156'), 'A subsequent school year projects its own Go out and destinations without first-year IDs.');
    assert.equal(await h.start(), true);
    const fresh = h.runner.getSnapshot().storyState;
    assert.equal(fresh.playthroughCount, 1); assert.deepEqual(fresh.attributes, initialStoryState(realSource).attributes);
    for (const id of requiredItems) assert.equal(fresh.items[id].min, 0);
    for (const behavior of Object.values(fresh.behaviors)) { assert.equal(behavior.count, 0); assert.equal(behavior.successes, 0); assert.notEqual(behavior.state, 'Accepted'); assert.notEqual(behavior.state, 'Finished'); }
    assert.deepEqual(fresh.exams, {}); assert.deepEqual(fresh.choices, {});
    assert.equal(fresh.endings['4'], true, 'The gallery persists separately from a fresh playthrough.');
    save();
  } catch (error) {
    const state = h.runner.getSnapshot().storyState;
    writeFileSync(new URL('../test-results/phase8-ending-playthrough-failure.json', import.meta.url), JSON.stringify({ error: String(error), day: state.dayIndex, journey: h.journey.getSnapshot(), favor: state.favor, items: state.items, gifts: state.gifts, purchases: state.shopPurchases, lastInputs: h.steps.slice(-20), cycles, hidden, mementos, endings }, null, 2));
    throw error;
  } finally { h.dispose(); }
});
