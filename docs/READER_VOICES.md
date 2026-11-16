# Reader spoken dialogue

The shared Reader voice pipeline now resolves every installed Japanese clip for all **574 authored `PlayVoice=true` nodes**, across the **429 scripts / 8,493 TalkItems**. The source audit checks **582 Japanese language/gender variants** and **511 distinct original voice files**. Both Rover variants follow each PlotAudio row's authored gender flags.

The previous manifest omitted **47 whole dialogue nodes** and **three female variants**. These were source-processing failures, not unavailable Japanese recordings. The repair adds **43 original voice assets**: 41 compressed clips and two surround announcements. The affected variants span 16 scripts; the complete original line keys, route keys and causes are enumerated in [source-audit-before.json](../test-results/reader-voice/source-audit-before.json).

Affected scripts are `1001`, `1002`, `1004`, `1009`, `1010`, `1011`, `1015`, `3005`, `3010`, `3011`, `3017`, `3030`, `3105`, `3106`, `9001` and `x1`. The three partially resolved nodes were `3030/33`, `/34` and `/59`, whose original keys are `EVENT_AVGmain_6300_33`, `_34` and `_59`. Their female-player clips now resolve alongside the existing male clips. [validation.json](../test-results/reader-voice/validation.json) includes counts and restored route keys for each affected script.

## Why the reported lines were silent

| Reader node | Original text key | Authored PlotAudio filename | Native format | Repaired asset |
| --- | --- | --- | --- | --- |
| `1001/1`, first-cycle announcement | `EVENT_AVGmain_1_1` | `vo_EVENT_AVGmain_1_1` | Five-channel Opus, mapping family 1 | `cbb8689bb5c78d81a5a1` |
| `1002/1`, later-cycle announcement | `EVENT_AVGmain_5_1` | `vo_EVENT_AVGmain_1_1` | The same authored announcement clip | `cbb8689bb5c78d81a5a1` |
| `1002/2`, following announcement | `EVENT_AVGmain_5_2` | `vo_EVENT_AVGmain_5_2` | Five-channel Opus, mapping family 1 | `8d2f99aafdc645a4b365` |
| `1004/3`, Chisa | `EVENT_AVGmain_15_3` | `vo_EVENT_AVGmain_15_3` | Mono Opus in a compressed, partially encrypted entry | `63f7e90888b78c9fddf8` |

The old WEM decoder accepted only mono/stereo Opus with mapping family 0. Both announcements contain **five channels and mapping family 1**, so their valid files failed a bare assertion and never acquired MP3 mappings. The decoder now uses Opus multistream with Wwise's channel mapping, preserves the authored sample count and 312-sample pre-skip, and writes the original speaker mask. The preparation step exports stereo MP3s with the centre channel included in the downmix.

The pak extractor confused the **2 KiB partial-decryption limit** with the **compressed stored checksum scope**. Compressed entries hash all stored blocks, including AES alignment. Chisa's entry stores 53,664 bytes; its recorded SHA-1 matches those complete bytes and differs from the first 2 KiB. All 41 affected compressed clips exhibit the same distinction. The extractor now verifies the complete compressed checksum before decompression and reads the full block table. Uncompressed entries retain their separate authored checksum rule.

The two opening captions keep their separate text keys and `script:nid` mappings. PlotAudio explicitly aliases `EVENT_AVGmain_5_1` to the first announcement's filename; shared audio does not merge the route keys. Across the dataset, 34 authored route nodes use filename aliases; the audit checks every one.

Both intro nodes retain `DialogDelay=0.08`. This metadata does not gate Reader voice playback: scene initialization delivers the correct dialogue event. The four missing manifest entries made automatic playback and Story Review silent after initialization as well. Speaker `701290`, displayed as **???**, has no voice exclusion; the original controller and the Reader select these clips by their literal line keys.

## Readiness and cancellation

The investigation also reproduced three independent lifecycle losses: a dialogue event before manifest readiness, dialogue before `AudioContext.resume()` completes, and first-gesture Story Review replay. Earlier tests always awaited both gates, hiding those cases. The [frozen baseline probe](../test-results/reader-voice/controller-baseline-lifecycle.json) records zero starts in each case and a successful ready-state control; this probe checks state with a mocked AudioContext.

`ReaderAudio` now retains one latest voice request and resolves it when both gates complete. Automatic requests must still match the current run, scene, script, node and visit. Historical replay retains its requested line key and validates the current run/scene. Advancing, restarting, restoring, completing, closing Review, changing scenes or disposing cancels pending voice and any obsolete decode. Naturally ended or restored dialogue is not automatically replayed. Current dialogue voice can finish loading beyond the effects channel's three-second late-shot limit.

Story Review subscribes to the audio snapshot so its replay buttons update when the manifest or selected language changes. Language selection remains exact; unavailable languages do not fall back to another language's spoken clip. The normal Reader and Developer view use the same engine.

## Complete source and render audit

[source-to-render.json](../test-results/reader-voice/source-to-render.json) independently enumerates raw FlowState `PlayVoice`, `TidTalk`, PlotAudio filename/gender/language fields, mounted media selection, source-cache identities and MP3 disk hashes. There are zero text-key mismatches, missing PlotAudio rows, dynamic voice parameters, Japanese variant failures or file-hash failures.

[shared-resolver.json](../test-results/reader-voice/shared-resolver.json) invokes the actual shared `voiceAssets` function for **4,592 script/language/player-gender selections**, covering all 574 voiced nodes, both genders and all four native language codes. All selections match the independent source inventory. It checks 1,148 Japanese selections and correctly returns no media for the 3,444 selections in absent languages.

The voiced nodes include 573 dialogue lines and one authored narration, `6023/22` (`AVG_HAOGANDU_81_22`). Both kinds emit the same Reader dialogue event and use the shared voice resolver, without requiring a named or visible character.

| Voice language | Authored language/gender references | Installed and resolved | Unavailable source filenames |
| --- | ---: | ---: | ---: |
| Japanese (`ja`) | 582 | 582 | 0 |
| English (`en`) | 582 | 0 | 511 |
| Chinese (`zh`) | 574 | 0 | 503 |
| Korean (`ko`) | 574 | 0 | 503 |

**No Japanese original clip remains unresolved.** English, Chinese and Korean filename requests are absent from the complete installed inventory of 146,161 audio records, which has zero inventory errors. These languages are not offered as playable selections in this installation. [unavailable-originals.json](../test-results/reader-voice/unavailable-originals.json) lists each requested filename and every referring original text/route key separately. This establishes local availability, not whether downloadable packs contain those clips.

The independent [Opus reference check](../test-results/reader-voice/opus-reference.json) repackages the original packets into Ogg without re-encoding and decodes them with FFmpeg's Opus path. Both announcements and Chisa match the Reader preparation decoder **sample for sample: 8,382,865 PCM samples, maximum difference 0**. Native source identities and the original stored-checksum comparison are retained in [native-failures.json](../test-results/reader-voice/native-failures.json). Wwise mapping references are [vgmstream's WEM parser](https://github.com/vgmstream/vgmstream/blob/master/src/meta/wwise.c), Git blob `686ec2c48196f160a8aaafe57ae07eedcef48bd5`, and [speaker mappings](https://github.com/vgmstream/vgmstream/blob/master/src/util/channel_mappings.h), Git blob `92a153738ab27fd0a55273e4436f9b4728c925f4`. These exact source identities are retained with the evidence.

## Reproduce the checks

With the existing local source data, complete audio inventory and private pak keyring:

```sh
python3 tools/prepare_audio.py /path/to/audio-inventory.json /private/path/pak-keyring.json --voices-only
python3 tools/audit_reader_voices.py --inventory /path/to/audio-inventory.json
node --experimental-strip-types tools/verify_reader_voice_coverage.mjs
npm run test:voices
npm test
npm run build
```

The `--voices-only` path rebuilds story voice while retaining existing event mappings. The audit separately verifies all 342 music, ambience, effect and interaction files against their existing hashes. The private keyring, original WEM cache and generated MP3 cache remain local; no key values enter the audit reports or repository.

## Normal Reader playback and Story Review

All four reported lines passed automatic playback and Story Review replay with **Japanese selected, voice volume 1, music 0 and effects/ambience/SFX 0**. The recordings contain the actual spoken output from the shared Reader audio owner.

| Reader node | Authored clip duration | Automatic playback | Story Review replay |
| --- | ---: | --- | --- |
| `1001/1` | 17.169 s | [Recording](../test-results/reader-voice/browser-after/train-first-auto/reader-with-actual-audio.mp4) | [Recording](../test-results/reader-voice/browser-after/train-first-review/reader-with-actual-audio.mp4) |
| `1002/1` | 17.169 s | [Recording](../test-results/reader-voice/browser-after/train-later-first-auto/reader-with-actual-audio.mp4) | [Recording](../test-results/reader-voice/browser-after/train-later-first-review/reader-with-actual-audio.mp4) |
| `1002/2` | 14.709 s | [Recording](../test-results/reader-voice/browser-after/train-later-second-auto/reader-with-actual-audio.mp4) | [Recording](../test-results/reader-voice/browser-after/train-later-second-review/reader-with-actual-audio.mp4) |
| `1004/3`, Chisa | 15.252 s | [Recording](../test-results/reader-voice/browser-after/chisa-auto/reader-with-actual-audio.mp4) | [Recording](../test-results/reader-voice/browser-after/chisa-review/reader-with-actual-audio.mp4) |

The first-cycle announcement was entered with normal **Start**. Chisa was reached with normal advances and eligible opening choices, then captured while advancing from `1004/2`. The later route was reached by completing the first school year through public controls, with **4,684 navigation steps** retained in the final trace. Its automatic capture was armed at completed `3021`, run 1, before the physical **Next cycle** click; it then entered `1002/1`, run 2, visit 1. The next automatic recording began at `1002/1` and captured the ordinary Advance into `1002/2`. Each Review replay preserved the current visit. Separate caption keys remain intact even though both opening announcements use the same authored media file.

The first-cycle and Chisa recordings were reused after their build, manifest, audio and video hashes were checked. Every final recording uses production bundle `index-B9HoUjmR.js`, SHA-256 `5477f96cb1e31d5d70be1658110aacc6cf46b2f2307b7e4ec4615197e4bb4592`, and the repaired manifest, SHA-256 `098f3d4cf6e64298ead419122beaa2d112963658f9a02cf6d512f3ab2f4146dc`. [completed-recordings.json](../test-results/reader-voice/browser-after/completed-recordings.json) retains each artifact hash and source identity; [the playback summary](../test-results/reader-voice/browser-after/verification-summary.json) retains settings and voice observations, and [the Next cycle boundary check](../test-results/reader-voice/browser-after/next-cycle-boundary-check.json) retains the arm-before-entry proof.

A passive AudioWorklet mirrored the actual destination connections **after the channel gains**. Delivered WAVs contain exactly the chronological output blocks observed there. MP4s use timestamped Reader screenshots and those captured WAVs. The four later-route videos were encoded after browser capture and cleanup, using the saved output and frames. Decoded source-buffer copies are comparison oracles only; they never supply delivered recording audio.

The independent [recording-verification.json](../test-results/reader-voice/recording-verification.json) checks all eight required line/mode combinations plus two delayed-start recordings. Every complete spoken buffer fits inside its captured output: **824,109 frames** for each opening announcement, **706,047** for the following announcement and **732,085** for Chisa, at 48 kHz. Six main recordings match the loaded voice buffer exactly; the two later opening recordings have a maximum mixer rounding difference of **2.3283064365386963e-10**. No spoken interval is missing. Independently decoding each delivered MP4's AAC audio gives whole-clip correlation **at least 0.999950** with the selected voice buffer, with complete speech bounds in every video.

## Delayed startup and retained baseline

Normal Reader startup keeps its loading curtain until the audio manifest is ready. Story Review before initial manifest readiness cannot be opened through public startup controls. The [delayed-load report](../test-results/reader-voice/browser-delayed/verification-summary.json) holds the exact manifest request, observes the physical Start block with `ready=false`, releases the request and then enters through normal Start. Both [automatic speech](../test-results/reader-voice/browser-delayed/train-first-auto/reader-with-actual-audio.mp4) and [Review replay](../test-results/reader-voice/browser-delayed/train-first-review/reader-with-actual-audio.mp4) contain the full announcement. The pre-readiness request races remain separately covered by the shared-class regressions; the authored 0.08-second metadata is not implicated in the reported silence.

The [baseline browser report](../test-results/reader-voice/browser-before/browser-report.json) preserves four completed first-cycle/Chisa recordings: actual destination silence for automatic playback and absent Review replay buttons, with the same Japanese and mute settings. That baseline process hit a temporary-profile cleanup race after its recordings finished, which the report distinguishes from recording completion. The successful final and delayed runs both report `errors=[]`, owned-browser exit code 0 and removed temporary profiles. [The final process observation](../test-results/reader-voice/browser-after/final-process-observation.json) also confirms the original driver PID and owned browser profile are absent. Retried navigation runs and their timeout/cleanup evidence remain separate from the passing recording results.

## Final validation

[validation.json](../test-results/reader-voice/validation.json) records **443/443 tests passed**, Python asset preparation passed, the production TypeScript/Vite build passed, and **4,592 shared-resolver selections with zero discrepancies**. The focused audio/lifecycle suite passed 71 tests, including 61 voice regressions; the pak-source tests passed 7 checks and the real encoded-packet decoder tests passed 4. The independent original Opus reference remains bit-identical across 8,382,865 PCM samples. Browser recording verification passed all **10 recordings**, separately from mocked lifecycle checks.

To reproduce browser playback after building, use the installed Chromium/FFmpeg and a process environment that permits the local capture server:

```sh
node tools/reader-voice-browser.mjs --phase=after --route=later --route-seconds=2400 --navigation-poll-ms=15
READER_RESULT_DIR=test-results/reader-voice/browser-delayed node tools/reader-voice-browser.mjs --phase=after --route=delayed
python3 tools/verify_reader_voice_recordings.py --extra-directory test-results/reader-voice/browser-delayed
```

Allow the complete public school-year traversal to finish before concluding that the later route is unreachable. Raw capture frames, full instrumentation logs, destination PCM, source-buffer oracles, native media caches and the private pak keyring remain local; the repository includes curated reports and the spoken MP4 recordings.
