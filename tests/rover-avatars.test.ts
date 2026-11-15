import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ScriptRunner } from '../src/engine/ScriptRunner.ts';
import { validateManifest } from '../src/engine/validation.ts';
import { roverDialogueAvatar, roverMaleAvatarRepairs, schoolAssetsForGender } from '../src/spine/SchoolRover.ts';
import { schoolPortraitByTalker, resolveSchoolPortrait, readSchoolExpressions, composeSchoolExpression } from '../src/spine/SchoolPortraitAssets.ts';
import { changliAssets, fullSpine } from './changli-fixtures.ts';
import { FakeClock } from './FakeClock.ts';
import { ChangliSpineActor } from '../src/spine/ChangliSpineScene.ts';
import type { RunnerSnapshot } from '../src/engine/types.ts';

const read=(file:string)=>JSON.parse(readFileSync(new URL(file,import.meta.url),'utf8'));
const speakerAvatarView=(snapshot:RunnerSnapshot)=>snapshot.presentation.characters.find(view=>view.character.who===snapshot.dialogue?.speakerId)!;
function atSeven() {
  const clock=new FakeClock(),runner=new ScriptRunner({clock,instantTransitions:false});
  assert.equal(runner.load(read('../public/data/scripts/1001.json'),validateManifest(read('../public/data/manifest.json'))),true);
  assert.equal(runner.start(),true);assert.equal(runner.getSnapshot().nid,1);
  while(runner.getSnapshot().nid!==7){clock.advanceBy(2000);assert.equal(runner.advance(),true);}
  clock.advanceBy(1000);
  return {runner,clock,snapshot:runner.getSnapshot()};
}

test('real 1001/1→7 Rover dialogue gets speaking brightness while stage Darken and authored identity remain intact',()=>{
  const {runner,snapshot}=atSeven();
  try {
    const view=speakerAvatarView(snapshot)!;
    assert.equal(snapshot.dialogue?.textKey,'EVENT_AVGmain_1_7');
    assert.equal(view.character.expression,700131);assert.equal(view.character.effect,'Darken');
    assert.equal(view.portraitOpacity,0);assert.equal(view.avatarOpacity,1);assert.equal(view.brightness,.58);
    for(const gender of ['male','female'] as const){
      const assets=schoolAssetsForGender(changliAssets,gender),avatar=roverDialogueAvatar(view.character,assets);
      assert.equal(avatar.brightness,1);assert.equal(avatar.character.effect,'Highlight');
      assert.equal(avatar.character.expression,gender==='female'?700056:700131);
      assert.equal(avatar.character.entrySequence,view.character.entrySequence);
      assert.equal(avatar.character.hidePortrait,true);assert.equal(avatar.character.hideAvatar,false);
      assert.equal(view.character.expression,700131);assert.equal(view.character.effect,'Darken');
      const definition=schoolPortraitByTalker.get(gender==='female'?850002:850001)!;
      assert.equal(resolveSchoolPortrait(avatar.character,assets,definition).kind,'spine');
      if(gender==='female')assert.equal(resolveSchoolPortrait(view.character,assets,definition).kind,'fallback','The stage keeps literal source validation.');
    }
    assert.equal(changliAssets.manifest.expressions['700131'].talkerId,850001);
  } finally {runner.dispose();}
});

test('female Reader fallback uses the verified 700056 composition and actual skeleton clips, without inventing the missing male mouth',()=>{
  const definition=schoolPortraitByTalker.get(850002)!;
  const base='../public/assets/solarschool/characters/rover-female/';
  const metadata=read(base+'rover-female.animation-metadata.json');
  const atlas=new fullSpine.TextureAtlas(readFileSync(new URL(base+'SolarSchool_Female.atlas',import.meta.url),'utf8'));
  for(const page of atlas.pages)page.texture=new fullSpine.Texture({width:page.width,height:page.height});
  const data=new fullSpine.SkeletonBinary(new fullSpine.AtlasAttachmentLoader(atlas)).readSkeletonData(new Uint8Array(readFileSync(new URL(base+'SolarSchool_Female.skel',import.meta.url))));
  const {runner,snapshot}=atSeven();
  try {
    const assets=schoolAssetsForGender(changliAssets,'female');
    const avatar=roverDialogueAvatar(speakerAvatarView(snapshot)!.character,assets);
    const resolution=resolveSchoolPortrait(avatar.character,assets,definition);
    assert.equal(resolution.kind,'spine');if(resolution.kind!=='spine')return;
    const composition=composeSchoolExpression(resolution.expression,readSchoolExpressions(metadata,definition),definition);
    assert.deepEqual([composition.body,composition.mouth,composition.eye],['dongzuo2_sikaozhan','dongzuo1_zhengchang_zui','dongzuo1_zhengchang_zhengyan']);
    for(const clip of [composition.body,composition.mouth,composition.eye,composition.blink!])assert.ok(data.findAnimation(clip),clip);
    assert.equal(data.findAnimation('dongzuo1_zhengchang_bizui'),null);
    assert.equal(avatar.fallback?.sourceExpressionId,700131);assert.equal(avatar.fallback?.expressionId,700056);
  } finally {runner.dispose();}
});

test('Rover fallbacks stay limited to the dialogue actor and explicit gender poses; other identities retain their behavior',()=>{
  const {runner,snapshot}=atSeven();
  try {
    const source=speakerAvatarView(snapshot)!.character,assets=schoolAssetsForGender(changliAssets,'female');
    const other={...source,who:'another-actor'};
    assert.equal(roverDialogueAvatar(other,assets).character,other);
    assert.equal(roverDialogueAvatar(other,assets).brightness,undefined);
    const thinking=roverDialogueAvatar({...source,expression:700133},assets);
    assert.equal(thinking.fallback?.expressionId,700058);assert.equal(thinking.character.expression,700058);
    assert.equal(resolveSchoolPortrait(thinking.character,assets,schoolPortraitByTalker.get(850002)!).kind,'spine');
    assert.equal(roverDialogueAvatar(source,schoolAssetsForGender(changliAssets,'male')).fallback,null);
    assert.equal(roverDialogueAvatar({...source,expression:700056},assets).fallback,null);
  } finally {runner.dispose();}
});

test('female dialogue reflection preserves negative head-icon translation and the calibrated anchor; male and Abby keep source facing',()=>{
  const definition=schoolPortraitByTalker.get(850002)!;
  const {runner,snapshot}=atSeven();
  const atlas=new fullSpine.TextureAtlas(readFileSync(new URL('../public/assets/solarschool/characters/rover-female/SolarSchool_Female.atlas',import.meta.url),'utf8'));
  for(const page of atlas.pages)page.texture=new fullSpine.Texture({width:page.width,height:page.height});
  const data=new fullSpine.SkeletonBinary(new fullSpine.AtlasAttachmentLoader(atlas)).readSkeletonData(new Uint8Array(readFileSync(new URL('../public/assets/solarschool/characters/rover-female/SolarSchool_Female.skel',import.meta.url))));
  const source=new ChangliSpineActor(fullSpine as never,data as never,{drawSkeleton(){}},{},definition.profile);
  const avatar=new ChangliSpineActor(fullSpine as never,data as never,{drawSkeleton(){}},{},{...definition.profile,horizontalFacing:definition.avatarFacing});
  try {
    assert.equal(definition.avatarFacing,-1);
    assert.equal(schoolPortraitByTalker.get(850001)!.avatarFacing,1);
    assert.equal(schoolPortraitByTalker.get(700005)!.avatarFacing??1,1);
    const projected=roverDialogueAvatar(speakerAvatarView(snapshot).character,schoolAssetsForGender(changliAssets,'female'));
    const resolution=resolveSchoolPortrait(projected.character,schoolAssetsForGender(changliAssets,'female'),definition);
    assert.equal(resolution.kind,'spine');if(resolution.kind!=='spine')return;
    const composition=composeSchoolExpression(resolution.expression,readSchoolExpressions(read('../public/assets/solarschool/characters/rover-female/rover-female.animation-metadata.json'),definition),definition);
    source.setExpression(composition);avatar.setExpression(composition);
    const view={...speakerAvatarView(snapshot),character:projected.character,position:[-80,150,1] as const,portraitOpacity:1};
    source.render(view,0);avatar.render(view,0);
    const anchor=definition.profile.calibration.anchorX;
    const x=avatar.skeleton.x+anchor*avatar.skeleton.scaleX;
    assert.ok(Math.abs(x-(1280-80))<1e-9);
    assert.equal(avatar.skeleton.scaleX,-source.skeleton.scaleX);
    assert.equal(avatar.skeleton.scaleY,source.skeleton.scaleY);
    assert.equal(avatar.skeleton.y,source.skeleton.y);
    const left=new fullSpine.Vector2(),size=new fullSpine.Vector2(),refLeft=new fullSpine.Vector2(),refSize=new fullSpine.Vector2();
    (avatar.skeleton as InstanceType<typeof fullSpine.Skeleton>).getBounds(left,size);
    (source.skeleton as InstanceType<typeof fullSpine.Skeleton>).getBounds(refLeft,refSize);
    assert.ok(Math.abs(left.x+refLeft.x+refSize.x-2*x)<.001,'Painted attachment bounds reflect around the translated anchor.');
    avatar.render({...view,position:[-180,150,1]},0);
    assert.ok(Math.abs(avatar.skeleton.x+anchor*avatar.skeleton.scaleX-(x-100))<1e-9,'More-negative PosX still translates left.');
  } finally {source.dispose();avatar.dispose();runner.dispose();}
});


test('all explicit gender avatar projections compose actual skeleton channels, including closed eyes for inherited 700129', () => {
  const { runner, snapshot } = atSeven();
  try {
    for (const [gender, ids, talkerId] of [
      ['female', [700126,700128,700129,700130,700131,700133,700134,700135], 850002],
      ['male', [700052,700053,700054,700056,700057,700058,700128,700129,700130,700133,700134,700135], 850001],
    ] as const) {
      const definition = schoolPortraitByTalker.get(talkerId)!, assets = schoolAssetsForGender(changliAssets, gender);
      const base = `../public/assets/solarschool/characters/${definition.slug}/`;
      const metadata = read(base + definition.metadataFile);
      const atlas = new fullSpine.TextureAtlas(readFileSync(new URL(base + definition.stem + '.atlas', import.meta.url), 'utf8'));
      for (const page of atlas.pages) page.texture = new fullSpine.Texture({ width: page.width, height: page.height });
      const skeleton = new fullSpine.SkeletonBinary(new fullSpine.AtlasAttachmentLoader(atlas)).readSkeletonData(new Uint8Array(readFileSync(new URL(base + definition.stem + '.skel', import.meta.url))));
      for (const id of ids) {
        const source = { ...speakerAvatarView(snapshot)!.character, expression: id };
        const avatar = roverDialogueAvatar(source, assets), resolved = resolveSchoolPortrait(avatar.character, assets, definition, 'avatar');
        assert.equal(source.expression, id); assert.equal(source.hidePortrait, true); assert.equal(source.effect, 'Darken');
        assert.equal(resolved.kind, 'spine'); if (resolved.kind !== 'spine') continue;
        const mapping = new Map([...readSchoolExpressions(metadata, definition), ...(talkerId === 850001 ? roverMaleAvatarRepairs : [])]);
        const composed = composeSchoolExpression(resolved.expression, mapping, definition);
        for (const clip of [composed.body, composed.eye, composed.mouth, composed.blink].filter(Boolean)) assert.ok(skeleton.findAnimation(clip!), `${gender} ${id}: ${clip}`);
        if (gender === 'female' && id === 700129) { assert.equal(avatar.fallback?.expressionId, 700053); assert.equal(composed.eye, 'dongzuo1_biyannanguo'); }
      }
    }
  } finally { runner.dispose(); }
});
