export type AudioChannel = 'music' | 'effects' | 'voice';
export interface AudioAsset { url: string; duration: number; source: string; }
export interface AudioClip { asset: string; offset: number; duration: number; loop: boolean; }
export interface AudioLayer { asset: string; loop: boolean; gain: number; rate: number; }
export interface AudioRandom { transitionMode: number; delay: number; delayMin: number; delayMax: number; avoidRepeat: number; shuffle: boolean; gain: number; variants: AudioLayer[]; }
export interface AudioCue {
  kind: 'music' | 'ambience' | 'effects' | 'voice';
  action: 'play' | 'stop' | 'silence'; target?: string;
  variants?: Record<string, string[]>; loop?: boolean; sequence?: boolean;
  clips?: AudioClip[];
  layers?: { continuous: AudioLayer[]; random: AudioRandom[] };
  assetSettings?: Record<string, { gain: number; rate: number; loop: boolean }>;
}
export interface VoiceLine { textKey: string; variants: Record<string, string>; }
export interface AudioManifest {
  schema: 1; languages: string[]; events: Record<string, AudioCue>; assets: Record<string, AudioAsset>;
  lines: Record<string, VoiceLine>; roleSpines: Record<string, { Id: number; RoleId: number; TextKey: string; AudioId: string; AnimationId: number }>;
  locationAmbience: Record<string, string>; unresolved: Record<string, string>;
  unresolvedEvents?: Record<string, { kind: AudioCue['kind']; reason: string }>;
}
/** Do not trust the snapshot's inferred `voice` category. Only resolved voice events qualify. */
export function voiceAssets(manifest: AudioManifest, script: string, nid: number, language: string, gender: string, cues: readonly string[] = []): string[] {
  const line = manifest.lines[`${script}:${nid}`];
  const asset = line?.variants[`${language}:${gender}`] ?? line?.variants[`${language}:any`];
  if (asset && manifest.assets[asset]) return [asset];
  return cues.flatMap(cue => {
    const event = manifest.events[cue];
    return event?.kind === 'voice' && event.action === 'play' ? event.variants?.[language]?.filter(id => !!manifest.assets[id]) ?? [] : [];
  });
}
