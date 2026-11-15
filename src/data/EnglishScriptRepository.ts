import { EngineError } from '../engine/EngineError.ts';
import { validateBuildReport, validateEnglish, validateIndex, validateManifest, validateSpeakers } from '../engine/validation.ts';
import type { Manifest, Metadata, ScriptIndexEntry, Speaker } from '../engine/types.ts';
import { emptyStorySource, validateStorySource } from '../engine/StoryState.ts';
import type { StorySource } from '../engine/StoryState.ts';

export interface EnglishCatalog {
  readonly manifest: Manifest;
  readonly index: readonly ScriptIndexEntry[];
  readonly english: Readonly<Record<string, string>>;
  readonly speakers: Readonly<Record<string, Speaker>>;
  readonly report: Metadata;
  readonly storySource?: StorySource;
  readonly storySourceError?: string;
}

type Fetcher = (url: string) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

/** Loads only the English locale and the selected neutral script, on demand. */
export class EnglishScriptRepository {
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private catalogPromise: Promise<EnglishCatalog> | null = null;
  private readonly scripts = new Map<string, Promise<unknown>>();

  // Keep native browser fetch on its global Window receiver when the stored
  // request function is invoked as a repository method.
  constructor(baseUrl: string, fetcher: Fetcher = url => globalThis.fetch(url)) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    this.fetcher = fetcher;
  }

  catalog(): Promise<EnglishCatalog> {
    this.catalogPromise ??= this.loadCatalog();
    return this.catalogPromise;
  }

  async script(id: string): Promise<unknown> {
    if (typeof id !== 'string' || !id) throw new EngineError('INVALID_SCRIPT_ID', 'ScriptId must be a nonempty string');
    const catalog = await this.catalog();
    if (!catalog.index.some(entry => entry.id === id)) throw new EngineError('UNKNOWN_SCRIPT', 'script is not present in the index', { scriptId: id });
    let pending = this.scripts.get(id);
    if (!pending) {
      pending = this.read(`scripts/${encodeURIComponent(id)}.json`, id).then(script => {
        if (!script || typeof script !== 'object' || !('id' in script) || script.id !== id) {
          throw new EngineError('SCRIPT_ID_MISMATCH', 'script ID does not match the requested file', { scriptId: id, path: `scripts/${id}.json.id` });
        }
        return script;
      });
      this.scripts.set(id, pending);
    }
    return pending;
  }

  private async loadCatalog(): Promise<EnglishCatalog> {
    const manifest = validateManifest(await this.read('manifest.json'));
    const [index, english, speakers, report] = await Promise.all([
      this.read(manifest.scripts), this.read('locales/en.json'),
      this.read('speakers.json'), this.read(manifest.report),
    ]);
    let storySource = emptyStorySource;
    let storySourceError: string | undefined;
    try { storySource = validateStorySource(await this.read('maps/story-source.json')); }
    catch (error) { storySourceError = error instanceof Error ? error.message : String(error); }
    return Object.freeze({
      manifest, index: validateIndex(index), english: validateEnglish(english),
      speakers: validateSpeakers(speakers), report: validateBuildReport(report),
      storySource, storySourceError,
    });
  }

  private async read(path: string, scriptId: string | null = null): Promise<unknown> {
    if (!/^[\w./%-]+\.json$/.test(path) || path.includes('..') || path.startsWith('/')) {
      throw new EngineError('INVALID_DATA_PATH', 'expected a relative JSON data path', { scriptId, path });
    }
    const url = `${this.baseUrl}${path}`;
    try {
      const response = await this.fetcher(url);
      if (!response.ok) throw new EngineError('DATA_LOAD_ERROR', `HTTP ${response.status}; generate the dataset with build_data.py first`, { scriptId, path: url });
      return await response.json();
    } catch (error) {
      if (error instanceof EngineError) throw error;
      throw new EngineError('DATA_LOAD_ERROR', error instanceof Error ? error.message : String(error), { scriptId, path: url });
    }
  }
}
