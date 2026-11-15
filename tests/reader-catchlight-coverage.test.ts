import assert from 'node:assert/strict';
import test from 'node:test';
import { models, expressionFor, verifyComposition, verifyTransition } from '../tools/reader_catchlight_source_check.mjs';

test('every available original composition matches source attachments, clipping, draw order and curves through blink/reopen', () => {
  for (const model of models) {
    let checked = 0;
    for (const expression of model.expressions.values()) {
      if (![expression.body, expression.mouth, expression.eye, expression.blink].filter((name): name is string => !!name).every(name => model.data.findAnimation(name))) continue;
      for (const composition of ['stage', 'avatar']) {
        const result = verifyComposition(model, expression, composition);
        assert.ok(result.passed, `${model.definition.slug}/${expression.id}/${composition}: ${JSON.stringify(result.issues.slice(0, 3))}`);
        assert.ok(result.openSamples >= 3);
        if (expression.blink) assert.ok(result.blinkSamples >= 3);
        checked++;
      }
    }
    assert.ok(checked > 0, `${model.definition.name} has a source composition to check.`);
  }
});

test('expression changes during and after a blink paint the new authored geometry on the first zero-delta frame', () => {
  // These source changes cover ordinary eyes, painted/static eyes, a wink,
  // different body poses and the existing Rover dialogue approximations.
  const cases = [
    ['changli', 700039, 700038, 'stage'],
    ['buling', 700082, 700074, 'stage'],
    ['verina', 700136, 700138, 'stage'],
    ['ciaccona', 700063, 700061, 'stage'],
    ['ciaccona', 700061, 700064, 'stage'],
    ['abby', 700212, 700222, 'avatar'],
    ['abby', 700212, 700215, 'avatar'],
    ['rover-male', 700133, 700134, 'avatar'],
    ['rover-female', 700058, 700057, 'avatar'],
  ] as const;
  for (const [slug, first, second, composition] of cases) {
    const model = models.find(item => item.definition.slug === slug)!;
    const from = expressionFor(model, first, composition)!, to = expressionFor(model, second, composition)!;
    const result = verifyTransition(model, from, to, composition);
    assert.ok(result.passed, `${slug}/${first}→${second}/${composition}: ${JSON.stringify(result.issues)}`);
    assert.equal(result.maximumVertexDifference, 0);
  }
});

test('Ciaccona wink replaces ordinary iris/reflection meshes with the authored combined face in both profiles', () => {
  const model = models.find(item => item.definition.slug === 'ciaccona')!;
  for (const composition of ['stage', 'avatar']) {
    const normal = verifyComposition(model, expressionFor(model, 700061, composition)!, composition);
    const wink = verifyComposition(model, expressionFor(model, 700064, composition)!, composition);
    assert.ok(normal.attachmentSignature!.some(slot => slot.slot === 'A_眼珠'));
    assert.ok(normal.attachmentSignature!.some(slot => slot.slot === 'A_高亮'));
    assert.ok(wink.attachmentSignature!.some(slot => slot.slot === '参考' && slot.attachment === 'CK_wink_001_'));
    assert.equal(wink.attachmentSignature!.some(slot => slot.slot === 'A_眼珠' || slot.slot === 'A_高亮'), false);
  }
});
