import { ChangliStageAdapter } from './ChangliStageAdapter.ts';
import type { ChangliAdapterOptions } from './ChangliStageAdapter.ts';
import { createChangliScene } from './ChangliSpineScene.ts';
import { composeSchoolExpression, resolveSchoolPortrait, schoolPortraitAssetCache } from './SchoolPortraitAssets.ts';
import type { SchoolPortraitDefinition } from './SchoolPortraitAssets.ts';
import type { SpinePortraitProfile } from './ChangliSpineScene.ts';
import { roverMaleAvatarRepairs } from './SchoolRover.ts';
import { validateSpinePortraitResources } from './SpinePortraitValidation.ts';

/** Reuse Changli's tested entry/load/frame lifecycle without consuming events. */
export class SchoolPortraitStageAdapter extends ChangliStageAdapter {
  constructor(canvas: HTMLCanvasElement, definition: SchoolPortraitDefinition, options: Omit<ChangliAdapterOptions, 'profile'> & { composition?: 'stage' | 'avatar'; stageProfile?: SpinePortraitProfile } = {}) {
    const { composition = 'stage', stageProfile, ...adapterOptions } = options;
    const portraitProfile = composition === 'avatar'
      ? { ...(definition.avatarProfile ?? definition.profile), horizontalFacing: definition.avatarFacing ?? 1, canvasTopOverscan: true,
          verifiedBlinks: new Set([...definition.profile.verifiedBlinks, ...(definition.talkerId === 850001 ? ['dongzuo1_zhoumei_zhayan'] : [])]) }
      : stageProfile ?? definition.profile;
    super(canvas, {
      ...adapterOptions,
      profile: {
        name: definition.name,
        resolve: (character, assets) => resolveSchoolPortrait(character, assets, definition, composition),
        compose: (expression, mapping) => composeSchoolExpression(expression, mapping, definition),
        load: async baseUrl => {
          const resources = await schoolPortraitAssetCache.load(baseUrl, definition);
          if (composition !== 'avatar' || definition.talkerId !== 850001) return resources;
          const avatar = { ...resources, expressions: new Map([...resources.expressions, ...roverMaleAvatarRepairs]) };
          validateSpinePortraitResources(avatar, portraitProfile, `${definition.stem}.png`);
          return avatar;
        },
        createScene: (target, resources) => createChangliScene(target, resources, {}, portraitProfile),
      },
    });
  }
}
