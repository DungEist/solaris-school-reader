Current spoken-dialogue repairs and complete voice coverage are recorded in [READER_VOICES.md](READER_VOICES.md). They supersede the earlier missing-voice counts and the claim that `1001/1` has no playable local voice below. The other Reader fixes and playback verification are recorded in [READER_RUNTIME_FIX.md](READER_RUNTIME_FIX.md); its music coverage and named VFX/avatar repairs supersede the earlier unresolved-coverage statements. Earlier source and runtime evidence remains retained as the baseline.

# Original audio in Solaris School Reader

The shared `ReaderAudio` engine plays original music, layered ambience, authored effects and verified voice in the normal Reader and Developer view. Playback starts from Start or another player gesture. Settings provides separate music, effects/ambience and voice volumes. Story Review offers replay only when a line or interaction has resolved voice media.

The data audit covers all **429 supported scripts, 196 location records and 98 RoleSpine interaction records**, including the supported exploration and school-year flows. It is data-wide coverage; browser observations exercise representative routes rather than every possible branch.

## Coverage and provenance

| Item | Result |
| --- | --- |
| Original research cues | 273 |
| Resolved research events and controls | 244 |
| Unresolved research events | 29 music cues |
| Runtime definitions | 245, including synthetic ambience silence |
| Unique original media exported | 779 MP3 files; 138,660,724 bytes |
| Resolved story voice node references | 527 |
| Unresolved story voice node references | 47, across 41 completely unresolved text keys |
| Additional partially resolved voice keys | 3 keys with unavailable female variants |
| Installed/resolved voice languages | Japanese (`ja`) |
| Original ambience banks projected as layers | 40 |

The original 273-cue research file remains [audio.json](../public/data/maps/audio.json). Playable media, control events, per-language voice and unresolved references are separate in [audio-playback.json](../public/data/maps/audio-playback.json). The full per-script, per-location and per-interaction audit is [coverage.json](../test-results/audio/coverage.json). [source-resolution.json](../test-results/audio/source-resolution.json) records bank hashes, source objects, authored clips, media aliases and failures.

Source installation:

```text
/game/SteamLibrary/steamapps/common/Wuthering Waves/Wuthering Waves Game/Client
```

Read-only inventory found 145,218 audio members across 67 readable paks. There are 33 unreadable pak inventories, including HD/Content copies and four Resource patches; these are a boundary on negative media searches, not proof that absent media never shipped. See [pak-inventory.json](../test-results/audio/pak-inventory.json).

Each exported file identifies its original WEM path, pak, WEM SHA-256, MP3 SHA-256, duration, sample rate, channels and decoded sample count. Selected pak payloads are checked against their stored SHA-1 before decoding. Local Wwise Opus media is decoded with libopus, preserving pre-skip and declared sample count, then encoded to MP3 with FFmpeg. Existing unrelated media is never exported. Cache metadata checks the source pak identity and WEM/MP3 hashes before reuse. Helper assemblies, transient banks, WEM caches and keys stay outside `public/`.

Some missing Solaris School MusicTrack source IDs have the same cache ID as installed music banks. Eight music cues were recovered this way; [music-aliases.json](../test-results/audio/music-aliases.json) preserves the correlation. Where one cache ID had two candidate media IDs, their extracted WEM bytes had identical SHA-256 before choosing either. No replacement music was invented for the other 29 cues.

## Original voice selection

Controller evidence comes from the local `Aki.Game.dll`:

```text
SHA-256: 069bcb5b9c3d4d28780be8f51b59e7d52d2a9cbd8eab2c037f2a3be925db2049
MVID:    793dfd03-0f45-4cd2-8afc-a8fedff89320
```

The retained managed IL is in [controller-audio-il.json](../test-results/audio/controller-audio-il.json), [interaction-il.json](../test-results/audio/interaction-il.json), [selection-il.json](../test-results/audio/selection-il.json), and [story-interaction-priority.json](../test-results/audio/story-interaction-priority.json). This tracing used the installed [reverse-engineer-anything skill](/home/deist/.agents/skills/reverse-engineer-anything/SKILL.md).

`VisualNovelAudio.CreateRecordedVoice` requires an authored `PlayVoice` flag and looks up the dialogue `TextKey` in **PlotAudio**. This is the additional story line-to-voice mapping. `PlotAudioModel.GetExternalSourcesMediaName` selects the effective voice language and constructs `<language>_<FileName>[_M|_F].wem`. `GlobalLanguage` selects `gl`; per-language gender flags select the suffix. Dynamic `VarParams` require additional state mapping and remain unresolved. The Reader selects only installed languages, with Japanese as the current default, and preserves gender selection where variants exist.

The generated `node.voice` is **TalkAkEvent**, which can contain BGM or mood effects. Its field name does not establish voice. The Reader routes those events by the resolved event purpose; only verified voice events or PlotAudio mappings enter the voice channel. Unresolved or unauthored voice stays silent. In particular, `1001/1` has no local playable voice, while `1001/9` and `1001/10` resolve to Japanese story voice.

For character interactions, the original controller chooses an eligible RoleTalk row, then reads the corresponding SolarSchoolRoleSpine's explicit `TextKey`/`AudioId` pair. It prioritizes the lowest appeared special map request (`BehaviorType=4`, matching `BindRoleId`, `DeliverEntry=2`, `ShowInMap`) until its preface has been viewed. Otherwise it selects resident (`TalkType=1`) or roaming (`TalkType=2`) rows filtered by location and date, then draws among eligible rows. The Reader uses its existing checkpointed deterministic draw policy, rather than claiming to reproduce the game's RNG sequence.

Examples:

- Changli: RoleTalk `1001` → RoleSpine `1001` → `SolarSchool_CharacterUI_FixedLocation_1_4` / `play_vo_avg_3_8_changli_01`. The Japanese event bank resolves to original voice media; effects and music cannot qualify as voice replay.
- Galbrena: RoleTalk `1007` → RoleSpine `1007` → `SolarSchool_CharacterUI_FixedLocation_5_4` / `play_vo_avg_3_8_jiabeilina_09`. This exact interaction and its Story Review replay were exercised in the normal Reader.

Fixed residents and explicitly authored exploration actors are supported. The original random daily placement of roaming characters has not been reconstructed; possible destinations are not treated as proof of presence. This limits which roaming interactions can be offered, rather than the shared audio engine's ability to play a resolved interaction.

## Playback and restoration

Stage delivery retains source timing and fast-forward flags. Music silence affects BGM independently of ambience. Location changes replace ambience or explicitly silence it. Music playlists preserve intro clips, authored trims and entry/exit boundaries; post-exit transition clips do not enter the main loop. Both leaf loops and the café-night repeating parent playlist are honored.

Ambience uses simultaneous continuous layers plus recurring random/shuffle branches with authored gain, pitch, delay, repeat avoidance and transition mode. Effects honor looping source properties and paired stop events. Scene boundaries cancel scene-local effects and voice; current music and ambience persist until replaced by authored events.

Advancing a line cancels obsolete voice, including a pending decode. Restart cancels old sources and timers. Checkpoint restore reduces durable audio history to current persistent music, ambience and un-stopped loops; it does not redeliver one-shots or voice. Fast-forwarded play events marked `SkipOnUltraFastForward` are consumed without entering durable history. Stop and silence controls still apply. Story Review retains resolved interactions through checkpoint restore, without automatically playing them again.

Fetch/decode runs independently of dialogue. Media fetch has a six-second timeout; stale completions cannot attach a source and one-shots arriving over three seconds late are dropped. The decoded buffer cache is bounded to 96 MiB when inactive buffers can be evicted. A missing music change silences the previous BGM instead of incorrectly retaining it.

This is a bounded Web Audio projection of the traced banks. Native Wwise bus processing, RTPC/state/switch behavior, spatial processing, filter curves and every possible transition-rule/fade are not reproduced or claimed to match the original mix. Source topology outside the parser's supported forms remains unresolved.

## Real browser playback evidence

Chromium exercised public Reader buttons at `http://127.0.0.1:5173/?audioProbe=1`, without injecting playback or replacing `AudioContext`, `fetch`, decoding or source start. The opt-in probe only observes engine state and samples channel gain nodes that remain connected to `AudioContext.destination`.

Completed observations:

- Opening/boundary run: `ev_1f0cfa9ddc95ee1830772af19bf63a06ab817e2ad7c6de445b8e40b336600b67`.
- Final normal run, through `1004/27`, including loop checkpoint restore: `ev_3404fd2ecd567beaa75d9bc10551aa88d1e3f5186e1a5d0f659edac08816236f`.
- Normal day-five interaction and replay, 942 public actions: `ev_c1055aae05b6e2c4c06d84aef3f990d075a221d38a81a25a30e38da06ecadd40`.

Across the latter two runs, **231 distinct files loaded, decoded and started playback**, with zero file failures and zero page errors. [playback-media.json](../test-results/audio/playback-media.json) identifies every such file, its source, hashes and per-cue counts. This is stronger evidence than a mocked `play()` call. Nonzero PCM was measured on each active channel; physical speakers and human hearing were not observed. Effects-channel samples include overlapping ambience/effects, so their RMS cannot establish an individual effect's isolated loudness.

| Authored case | Original media actually played | Observed behavior |
| --- | --- | --- |
| `1001/1` | Train `955544654.wem`; train stop `212446387.wem` | Music silence, train ambience and one-shot start; opening run waits for the train-stop sound |
| Station at `1001/5` | `187796493`, `215890621`, `818943253`, `651478570`, `526305781`, `1034255484` WEMs in final run | Train ambience stops; station continuous/random layers start, with authored wind effect |
| Footsteps at `1001/7` | `248065812.wem` | Loaded, decoded, started and ended |
| `1001/9`, `1001/10` | `ja_vo_EVENT_AVGmain_1_9.wem`, `ja_vo_EVENT_AVGmain_1_10.wem` | Japanese story voice; voice RMS maxima approximately 0.172 and 0.182 |
| Music at `1001/11` | `486539445.wem` (`funny_03`) | Real music output, RMS approximately 0.038 |
| Later music changes | `124384071.wem` (`27`), `1049515295.wem` (`26`), `24244011.wem` (`16`) | Prior music replaced; music `16` RMS approximately 0.073 |
| Loop at `1004/3`, stop at `1004/26` | `458706112.wem` (`hotpoop`) | Loaded/decoded once, started twice because checkpoint reconstructs it; two stops, including authored stop; absent at `1004/27` |
| Galbrena interaction/replay | `ja/453517075.wem`, asset `2acae0b8917e68a20c1c` | Japanese voice played at its explicit interaction and replayed from Story Review; isolated voice RMS approximately 0.193 |

Music and effects were muted through Settings before Galbrena's greeting, isolating the voice measurement. All three volume controls were then set to zero; final samples on music, effects and voice were zero. No English, Chinese or Korean voice pack is installed or runtime-verified.

Raw evidence and telemetry: [browser-final.json](../test-results/audio/browser-final.json), [browser-interaction.json](../test-results/audio/browser-interaction.json), earlier [browser-playback.json](../test-results/audio/browser-playback.json), and compact [browser-summary.json](../test-results/audio/browser-summary.json). Reproducible REA requests: [audio-browser-scenario.json](../tools/audio-browser-scenario.json) and [audio-interaction-browser-request.json](../tools/audio-interaction-browser-request.json).

## Rebuilding and remaining gaps

Run from the workspace with existing Python dependencies (`pycryptodome`), .NET 8, libopus and FFmpeg. Supply the local pak key via a private file; do not place it in this repository or public assets.

```bash
python3 tools/setup_audio_helper.py /absolute/path/to/local/FModel.exe
python3 tools/wwise_sources.py /absolute/path/to/game/Client --key-file /private/path/pak-key.bin --output /tmp/solar-audio-inventory.json
python3 tools/prepare_audio.py /tmp/solar-audio-inventory.json /private/path/pak-key.bin
python3 tools/trace_music_aliases.py /tmp/solar-audio-inventory.json --key-file /private/path/pak-key.bin
python3 tools/prepare_audio.py /tmp/solar-audio-inventory.json /private/path/pak-key.bin
python3 tools/audio_coverage.py
npm run build
```

The Oodle helper is built offline from the operator's existing FModel bundle; its framework references are adjusted to installed .NET 8 without changing decompressor code. `SOLARSCHOOL_OODLE_HELPER` can select another existing helper. Alias tracing temporarily inspects bank bytes and exports only correlation evidence.

Unresolved music includes seasonal day/evening cues, festival music and Solaris School tracks `01–15`, `20`, `21`, `23–25`, `28`, `30`. The full 29-event list and reasons are separate from playable media in the manifest and coverage report.

There are 47 completely unplayable authored voice node references across 41 text keys. Three additional keys (`EVENT_AVGmain_6300_33`, `_34`, `_59`) have playable male media but female source extraction fails stored SHA-1 verification; those female variants stay silent. Thus 44 text keys have at least one unresolved voice variant. Language-specific failure records are retained separately; the 143 total unresolved records are not 143 distinct missing cues. Movie playback and its matching movie audio remain skipped by the existing Reader policy.

Validation: the full suite passed 342 tests plus Python asset checks before the final restoration fixes. The final focused audio, timing and backlog suite passed 31 tests, including fast-forward/restore and interaction-history regressions; final production build and Python asset checks passed. Mocked AudioContext tests validate cancellation and state only; the Chromium evidence above establishes actual media decoding, source playback and output signal.
