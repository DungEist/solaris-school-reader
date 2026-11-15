import type { SpineRuntime } from './SpineRuntime.ts';

const pending = new Map<string, Promise<SpineRuntime>>();

/** All portraits share the supplied local runtime, including concurrent loads. */
export function loadLocalSpineRuntime(url: string): Promise<SpineRuntime> {
  let result = pending.get(url);
  if (!result) {
    result = new Promise<SpineRuntime>((resolve, reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(() => { script.remove(); reject(new Error(`Local Spine runtime timed out: ${url}`)); }, 10000);
      script.src = url;
      script.onload = () => {
        clearTimeout(timer);
        const runtime = (globalThis as unknown as { spine?: SpineRuntime }).spine;
        if (!runtime?.SkeletonBinary || !runtime.SceneRenderer) { reject(new Error('Local Spine 4.1 runtime is incomplete.')); return; }
        resolve(runtime);
      };
      script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error(`Local Spine runtime could not load: ${url}`)); };
      document.head.append(script);
    });
    pending.set(url, result);
  }
  return result;
}
