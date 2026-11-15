import { storyDate } from './StoryState.ts';
import type { Metadata } from './types.ts';
import type { StorySource, StoryState } from './StoryState.ts';
/** Original priority: the lowest appeared map request, until its preface was viewed. */
export function priorityTalkBehavior(state: StoryState, source: StorySource, roleId: number): number | null {
  const ids = Object.values(source.behaviors ?? {}).filter(row => Number(row.BehaviorType) === 4 && Number(row.BindRoleId) === roleId && Number(row.DeliverEntry) === 2 && row.ShowInMap === true && state.behaviors[String(row.BehaviorId)]?.state === 'Appeared').map(row => Number(row.BehaviorId)).sort((a, b) => a - b);
  const id = ids[0]; return id && !state.specialTalkViewed?.[String(id)] ? id : null;
}
/** Fixed residents and explicitly authored exploration actors. Random daily
 * placement is not inferred from a list of possible destinations. */
export function greetingRows(state: StoryState, source: StorySource): readonly Metadata[] {
  if (state.dayIndex === null || state.locationId === null) return [];
  const weekday = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][storyDate(state.dayIndex).weekday - 1];
  const present = new Map<number, number>();
  for (const row of Object.values(source.roleSchedules ?? {})) {
    const schedule = row[weekday];
    if (Array.isArray(schedule) && schedule[0] === 0 && schedule.slice(1).includes(state.locationId)) present.set(Number(row.RoleId), 1);
  }
  const actors = source.locations?.[String(state.locationId)]?.RoleIds;
  if (Array.isArray(actors)) for (const roleId of actors) present.set(Number(roleId), 2);
  return Object.values(source.roleTalks ?? {}).filter(row => {
    const role = Number(row.RoleId), priority = priorityTalkBehavior(state, source, role);
    return present.has(role) && (priority ? Number(row.TalkType) === 3 : present.get(role) === Number(row.TalkType)) && state.favor[String(role)]?.unlocked && (!Number(row.StartDayIndex) || state.dayIndex! >= Number(row.StartDayIndex)) && (!Number(row.EndDayIndex) || state.dayIndex! <= Number(row.EndDayIndex)) && (!Array.isArray(row.LocationIdList) || !row.LocationIdList.length || row.LocationIdList.includes(state.locationId)) && !!source.roleSpines?.[String(row.RoleSpineId)]?.TextKey;
  });
}
