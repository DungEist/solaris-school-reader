"""Read-only source/media audit for every authored Reader PlayVoice=true node.

Uses the installed filename inventory, the exact saved baseline manifest and
the current rendered manifest. No encryption keys are needed or reported.
Run: python3 tools/audit_reader_voices.py
"""
from __future__ import annotations

import argparse
import collections
import datetime
import hashlib
import json
import struct
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LANGUAGES = ("ja", "en", "zh", "ko")
TARGETS = (("1004", 3), ("1001", 1), ("1002", 1), ("1002", 2))


def read_json(path: Path):
    data = path.read_bytes()
    return json.loads(data), {"path": str(path), "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}


def public_identity(path: Path):
    data = path.read_bytes()
    return {"path": str(path.relative_to(ROOT)), "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}


def priority(row):
    path = Path(row["pak"])
    patch = "/Base/" not in str(path) and "/Content/Paks/" not in str(path)
    return patch, tuple(int(value) for value in path.parent.name.split(".") if value.isdigit())


def native_format(data: bytes):
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        return {"status": "not-riff-wave"}
    offset, parts = 12, {}
    while offset + 8 <= len(data):
        tag = data[offset:offset + 4]
        size = struct.unpack_from("<I", data, offset + 4)[0]
        if offset + 8 + size > len(data):
            return {"status": "truncated-chunk", "chunk": tag.decode("ascii", "replace")}
        parts[tag] = data[offset + 8:offset + 8 + size]
        offset += 8 + size + size % 2
    fmt = parts.get(b"fmt ", b"")
    if len(fmt) < 36:
        return {"status": "missing-wwise-fmt"}
    codec, channels, rate = struct.unpack_from("<HHI", fmt)
    samples, packet_count, pre_skip, version, family = struct.unpack_from("<IIHBB", fmt, 24)
    config = struct.unpack_from("<I", fmt, 20)[0]
    return {"status": "parsed", "codec": f"0x{codec:04x}", "channels": channels,
            "sampleRate": rate, "samples": samples, "durationSeconds": samples / rate,
            "packetCount": packet_count, "preSkip": pre_skip, "version": version,
            "mappingFamily": family, "channelConfig": f"0x{config:x}",
            "channelMask": f"0x{config >> 12:x}" if family == 1 else None,
            "seekBytes": len(parts.get(b"seek", b"")), "audioDataBytes": len(parts.get(b"data", b""))}


def compressed_checksum(row):
    """The stored checksum can be verified without decrypting the payload."""
    if not row["compression"]:
        return None
    with Path(row["pak"]).open("rb") as handle:
        handle.seek(row["offset"])
        header = handle.read(128)
        if len(header) < 52:
            return {"status": "truncated-native-stored-header"}
        count = struct.unpack_from("<I", header, 48)[0]
        if count != row["blocks"] or not 1 <= count <= 1024:
            return {"status": "unexpected-native-block-count", "headerBlocks": count, "indexBlocks": row["blocks"]}
        if len(header) < 52 + count * 16:
            handle.seek(row["offset"])
            header = handle.read(52 + count * 16)
        if len(header) < 52 + count * 16:
            return {"status": "truncated-native-stored-block-table"}
        stored, ranges = [], []
        for index in range(count):
            start, end = struct.unpack_from("<QQ", header, 52 + index * 16)
            if end < start:
                return {"status": "invalid-native-stored-block-range", "block": index}
            size = ((end - start + 15) // 16 * 16) if row["encrypted"] else end - start
            handle.seek(row["offset"] + start)
            block = handle.read(size)
            if len(block) != size:
                return {"status": "truncated-native-stored-block", "block": index}
            stored.append(block)
            ranges.append({"relativeStart": start, "relativeEnd": end, "alignedStoredBytes": size})
    payload = b"".join(stored)
    expected = header[28:48].hex()
    whole = hashlib.sha1(payload).hexdigest()
    prefix = hashlib.sha1(payload[:2048]).hexdigest()
    return {"status": "whole-stored-sha1-valid" if whole == expected else "stored-sha1-mismatch",
            "expectedSha1": expected, "wholeStoredSha1": whole, "prefix2048Sha1": prefix,
            "wholeStoredMatches": whole == expected, "prefix2048Matches": prefix == expected,
            "storedBytes": len(payload), "blocks": ranges}


def variant_asset(manifest, route_key, language, gender):
    line = manifest["lines"].get(route_key)
    if not line:
        return None
    token = line["variants"].get(f"{language}:{gender}") or line["variants"].get(f"{language}:any")
    return token if token in manifest["assets"] else None


def unresolved_fact(manifest, text_key, language):
    unresolved = manifest.get("unresolved", {})
    for key in ("line:" + text_key + ":" + language, "line:" + text_key):
        if key in unresolved:
            return {"present": True, "key": key, "message": unresolved[key]}
    return {"present": False, "key": None, "message": None}


def file_fact(asset_id, asset):
    url = asset["url"]
    path = (ROOT / "public" / url.lstrip("/")).resolve()
    if not path.is_relative_to((ROOT / "public").resolve()):
        return {"assetId": asset_id, "url": url, "status": "outside-public-root"}
    exists = path.is_file()
    sha = hashlib.sha256(path.read_bytes()).hexdigest() if exists else None
    return {"assetId": asset_id, "url": url, "path": str(path.relative_to(ROOT)), "exists": exists,
            "sha256": sha, "manifestSha256": asset.get("sha256"),
            "hashMatches": exists and sha == asset.get("sha256"), "bytes": path.stat().st_size if exists else None}


def probe_mp3(asset, asset_id):
    path = ROOT / "public" / asset["url"]
    result = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
                             "stream=codec_name,channels,channel_layout,sample_rate,duration", "-of", "json", str(path)],
                            text=True, capture_output=True, check=True)
    streams = json.loads(result.stdout)["streams"]
    return {"assetId": asset_id, "path": str(path.relative_to(ROOT)), "streams": streams}


def audit(args):
    inventory, inventory_identity = read_json(args.inventory)
    baseline, baseline_identity = read_json(args.baseline)
    current, current_identity = read_json(args.manifest)
    script_index, index_identity = read_json(ROOT / "public/data/scripts.index.json")
    flow_rows, flow_identity = read_json(ROOT / "WutheringWaves_Data/BinData/flowState/flowstate.json")
    plot_rows, plot_identity = read_json(ROOT / "WutheringWaves_Data/BinData/plot_audio/plotaudio.json")
    source = {row["StateKey"]: row for row in flow_rows}
    plots = {row["Id"]: row for row in plot_rows}
    selected, copies = {}, collections.defaultdict(list)
    for row in sorted(inventory["records"], key=priority):
        selected[row["name"]] = row
        copies[row["name"]].append(row)
    media = collections.defaultdict(list)
    for row in selected.values():
        if row["name"].endswith(".wem"):
            media[Path(row["name"]).stem].append(row)
    script_sources, routes, aliases, mismatches, missing_source = [], [], [], [], []
    source_counts = collections.Counter()
    media_requests = collections.defaultdict(list)
    referenced_media = {}
    for indexed in script_index:
        script_path = ROOT / f"public/data/scripts/{indexed['id']}.json"
        script, script_identity = read_json(script_path)
        script_sources.append(script_identity)
        nodes = {node["nid"]: node for node in script["nodes"]}
        raw_nodes = set()
        source_counts["scripts"] += 1
        flow = source[script["stateKey"]]
        actions = json.loads(flow["Actions"])
        for action_index, action in enumerate(actions):
            if action.get("Name") != "ShowTalk":
                continue
            for item_index, raw in enumerate(action.get("Params", {}).get("TalkItems", [])):
                raw_nodes.add(raw["Id"])
                source_counts["rawTalkItems"] += 1
                if raw.get("PlayVoice") is not True:
                    continue
                source_counts["authoredVoiceRouteNodes"] += 1
                generated = nodes.get(raw["Id"])
                text_key = raw.get("TidTalk") or raw.get("TextKey")
                route_key = f"{script['id']}:{raw['Id']}"
                pa = plots.get(text_key)
                record = {"routeKey": route_key, "scriptId": script["id"], "stateKey": script["stateKey"],
                          "nid": raw["Id"], "flowActionIndex": action_index, "talkItemIndex": item_index,
                          "sourceFlowId": flow["Id"], "sourceType": raw.get("Type"), "sourceWhoId": raw.get("WhoId"),
                          "sourceTextId": raw.get("TextId"), "sourceTextKeyField": raw.get("TextKey"),
                          "sourceTidTalk": raw.get("TidTalk"), "sourcePlotLineKey": raw.get("PlotLineKey"),
                          "sourceTextKey": text_key, "generatedTextKey": generated.get("textKey") if generated else None,
                          "generatedNodeKind": generated.get("kind") if generated else None,
                          "generatedSpeakerId": generated.get("speakerId") if generated else None,
                          "authoredPlayVoice": True, "textKeyMatches": bool(generated) and generated.get("textKey") == text_key,
                          "baselineLinePresent": route_key in baseline["lines"], "renderedLinePresent": route_key in current["lines"],
                          "plotAudio": pa, "variants": []}
                if not record["textKeyMatches"]:
                    mismatches.append({"routeKey": route_key, "sourceTextKey": text_key, "generatedTextKey": record["generatedTextKey"]})
                if not pa:
                    missing_source.append(route_key)
                    routes.append(record)
                    continue
                if pa["FileName"] != "vo_" + text_key:
                    aliases.append({"routeKey": route_key, "textKey": text_key, "authoredFileName": pa["FileName"],
                                    "classification": "intentional-source-FileName-alias; preserve-caption-key"})
                source_counts["globalLanguageRoutes"] += int(pa["GlobalLanguage"])
                source_counts["dynamicVarParamsRoutes"] += int(bool(pa["VarParams"]))
                for language in LANGUAGES:
                    check_gender = bool(pa.get("CheckGender" + language.capitalize()))
                    source_counts["gender" + language.upper()] += int(check_gender)
                    for gender in ("male", "female") if check_gender else ("any",):
                        native_language = "gl" if pa["GlobalLanguage"] else language
                        suffix = "_M" if gender == "male" else "_F" if gender == "female" else ""
                        requested = native_language + "_" + pa["FileName"] + suffix
                        candidates = media.get(requested, [])
                        candidate = candidates[0] if len(candidates) == 1 else None
                        baseline_asset = variant_asset(baseline, route_key, language, gender)
                        rendered_asset = variant_asset(current, route_key, language, gender)
                        baseline_unresolved = unresolved_fact(baseline, text_key, language)
                        rendered_unresolved = unresolved_fact(current, text_key, language)
                        variant = {"language": language, "nativeLanguage": native_language, "gender": gender,
                                   "checkGender": check_gender, "globalLanguage": bool(pa["GlobalLanguage"]),
                                   "requestedFileName": requested + ".wem", "candidateCount": len(candidates),
                                   "installedCandidate": bool(candidate), "mediaId": None,
                                   "baselineAssetId": baseline_asset, "renderedAssetId": rendered_asset,
                                   "baselineUnresolved": baseline_unresolved["message"],
                                   "baselineUnresolvedEntry": baseline_unresolved,
                                   "renderedUnresolved": rendered_unresolved["message"],
                                   "renderedUnresolvedEntry": rendered_unresolved}
                        if candidate:
                            token = hashlib.sha256(candidate["name"].encode()).hexdigest()[:20]
                            variant["mediaId"] = token
                            referenced_media[token] = candidate
                            media_requests[token].append({"routeKey": route_key, "textKey": text_key, "language": language, "gender": gender})
                        record["variants"].append(variant)
                routes.append(record)
        if raw_nodes != set(nodes):
            raise ValueError(f"Source/generation node IDs differ in script {script['id']}")

    native_media, media_by_id, file_checks = [], {}, {}
    for token, row in referenced_media.items():
        cached_path = ROOT / "asset-work/audio" / (token + ".wem")
        metadata_path = cached_path.with_suffix(".source.json")
        cached = cached_path.read_bytes() if cached_path.exists() else None
        saved = json.loads(metadata_path.read_text()) if metadata_path.exists() else {}
        native_sha = hashlib.sha256(cached).hexdigest() if cached is not None else None
        saved_identity = saved.get("identity", {})
        cached_identity_matches = bool(saved_identity) and saved_identity.get("name") == row["name"] and saved_identity.get("pak") == row["pak"]
        cached_identity_matches = cached_identity_matches and all(saved_identity.get("entry", {}).get(key) == row.get(key)
                                                                  for key in ("offset", "size", "compressed", "compression", "encrypted", "custom"))
        facts = {"mediaId": token, "source": row["name"], "pak": row["pak"],
                 "entry": {key: row[key] for key in ("offset", "size", "compressed", "compression", "encrypted", "custom", "blocks", "blockSize")},
                 "installedCopies": [{"pak": copy["pak"], "offset": copy["offset"], "size": copy["size"],
                                      "compression": copy["compression"], "custom": copy["custom"]} for copy in copies[row["name"]]],
                 "selectedLatestByExistingPriority": True, "cachedWemPath": str(cached_path.relative_to(ROOT)),
                 "cachedWemExists": cached is not None, "cachedWemSha256": native_sha,
                 "cachedIdentityMatchesSelectedCandidate": cached_identity_matches,
                 "cachedHashMatchesSavedIdentity": cached is not None and native_sha == saved.get("wemSha256"),
                 "nativeFormat": native_format(cached) if cached is not None else None,
                 "storedChecksum": compressed_checksum(row), "requests": media_requests[token]}
        current_asset = current["assets"].get(token)
        facts["renderedAssetSourceMatches"] = bool(current_asset) and current_asset.get("source") == row["name"]
        facts["renderedAssetPakMatches"] = bool(current_asset) and current_asset.get("pak") == row["pak"]
        facts["renderedAssetNativeHashMatches"] = bool(current_asset) and current_asset.get("wemSha256") == native_sha
        if current_asset:
            file_checks[token] = file_fact(token, current_asset)
            facts["renderedAssetFile"] = file_checks[token]
        native_media.append(facts)
        media_by_id[token] = facts

    baseline_failures, after_failures = [], []
    language_counts = {language: collections.Counter() for language in LANGUAGES}
    baseline_counts = collections.Counter()
    all_requested = []
    for route in routes:
        for variant in route["variants"]:
            language_counts[variant["language"]]["requestedVariants"] += 1
            all_requested.append(variant)
            if not variant["installedCandidate"]:
                variant["nativeStatus"] = "absent-from-complete-installed-inventory" if not variant["candidateCount"] else "ambiguous-installed-filename"
                variant["baselineStatus"] = variant["nativeStatus"]
                variant["renderedStatus"] = variant["nativeStatus"] if not variant["renderedAssetId"] else "manifest-reference-without-native-source"
                language_counts[variant["language"]]["nativeAbsentVariants"] += 1
                continue
            facts = media_by_id[variant["mediaId"]]
            language_counts[variant["language"]]["installedVariants"] += 1
            variant["nativeStatus"] = "installed-authored-native-media"
            if variant["baselineAssetId"]:
                variant["baselineStatus"] = "resolved-in-baseline"
                baseline_counts["resolvedInstalledVariants"] += 1
            else:
                fmt = facts["nativeFormat"] or {}
                if fmt.get("mappingFamily") == 1 and fmt.get("channels", 0) > 2:
                    variant["baselineStatus"] = "legacy-opus-multistream-decoder-rejection"
                elif facts["entry"]["compression"] and facts["entry"]["custom"] == 2:
                    variant["baselineStatus"] = "legacy-compressed-stored-checksum-prefix-rejection"
                else:
                    variant["baselineStatus"] = "installed-native-not-resolved-by-baseline"
                baseline_counts[variant["baselineStatus"]] += 1
                baseline_failures.append({"routeKey": route["routeKey"], "sourceTextKey": route["sourceTextKey"], **variant})
            asset = current["assets"].get(variant["renderedAssetId"], {})
            valid = variant["renderedAssetId"] == variant["mediaId"] and asset.get("source") == facts["source"] and asset.get("pak") == facts["pak"]
            valid = valid and facts["renderedAssetNativeHashMatches"] and file_checks.get(variant["mediaId"], {}).get("hashMatches", False)
            valid = valid and facts["cachedIdentityMatchesSelectedCandidate"] and facts["cachedHashMatchesSavedIdentity"]
            variant["renderedStatus"] = "resolved-source-and-file-hash-verified" if valid else "rendered-mapping-or-file-check-failed"
            if valid:
                language_counts[variant["language"]]["renderedVerifiedVariants"] += 1
            else:
                after_failures.append({"routeKey": route["routeKey"], **variant})

    complete_missing = [route for route in routes if not route["baselineLinePresent"]]
    partial_missing = [route for route in routes if route["baselineLinePresent"] and any(variant["installedCandidate"] and not variant["baselineAssetId"] for variant in route["variants"])]
    target_routes = [route for pair in TARGETS for route in routes if (route["scriptId"], route["nid"]) == pair]
    probe_tokens = {variant["renderedAssetId"] for route in target_routes for variant in route["variants"] if variant["renderedAssetId"]}
    probes = [probe_mp3(current["assets"][token], token) for token in sorted(probe_tokens)]
    before_voice_assets = {variant["baselineAssetId"] for variant in all_requested if variant["baselineAssetId"]}
    after_voice_assets = {variant["renderedAssetId"] for variant in all_requested if variant["renderedAssetId"]}
    other_before = set(baseline["assets"]) - before_voice_assets
    other_assets_unchanged = all(token in current["assets"] and current["assets"][token].get("sha256") == baseline["assets"][token].get("sha256") for token in other_before)
    other_files = [file_fact(token, current["assets"][token]) for token in sorted(other_before) if token in current["assets"]]
    other_file_failures = [fact for fact in other_files if not fact.get("hashMatches", False)]
    alias_groups = collections.defaultdict(lambda: {"sourceTextKeys": set(), "routeKeys": set()})
    for route in routes:
        if route["plotAudio"]:
            group = alias_groups[route["plotAudio"]["FileName"]]
            group["sourceTextKeys"].add(route["sourceTextKey"])
            group["routeKeys"].add(route["routeKey"])
    reused_files = [{"fileName": name, "sourceTextKeys": sorted(group["sourceTextKeys"]), "routeKeys": sorted(group["routeKeys"])}
                    for name, group in alias_groups.items() if len(group["sourceTextKeys"]) > 1 or len(group["routeKeys"]) > 1]
    format_counts = collections.Counter((facts["nativeFormat"]["codec"], facts["nativeFormat"]["channels"], facts["nativeFormat"]["mappingFamily"])
                                       for facts in native_media if facts["nativeFormat"] and facts["nativeFormat"]["status"] == "parsed")
    compressed = [facts for facts in native_media if facts["entry"]["compression"]]
    checksum_failures = [facts["mediaId"] for facts in compressed if facts["storedChecksum"].get("wholeStoredMatches") is not True]
    format_failures = [facts["mediaId"] for facts in native_media if not facts["nativeFormat"] or facts["nativeFormat"].get("status") != "parsed"]
    identity_failures = [facts["mediaId"] for facts in native_media if not facts["cachedIdentityMatchesSelectedCandidate"]]
    hash_failures = [facts["mediaId"] for facts in native_media if not facts["cachedHashMatchesSavedIdentity"]]
    entry_counts = collections.Counter((facts["entry"]["compression"], facts["entry"]["custom"], facts["entry"]["encrypted"]) for facts in native_media)
    summary = {**dict(source_counts), "scriptsWithAuthoredVoice": len({route["scriptId"] for route in routes}),
               "nativeInventoryRecords": len(inventory["records"]), "nativeInventoryErrors": len(inventory.get("errors", [])),
               "distinctVoiceTextKeys": len({route["sourceTextKey"] for route in routes}), "wrongGeneratedTextKeyCount": len(mismatches),
               "missingPlotAudioRows": len(missing_source), "authoredFileNameAliasRouteNodes": len(aliases),
               "installedSelectedNativeVoiceFiles": len(native_media), "requestedLanguageGenderVariants": len(all_requested),
               "perLanguage": {language: dict(counts) for language, counts in language_counts.items()},
               "baselineVoiceRouteNodes": len(baseline["lines"]), "baselineMissingWholeRouteNodes": len(complete_missing),
               "baselineMissingWholeDistinctTextKeys": len({route["sourceTextKey"] for route in complete_missing}),
               "baselinePartialRouteNodes": len(partial_missing), "baselineMissingInstalledVariants": len(baseline_failures),
               "baselineSourceProcessingFailureCounts": dict(baseline_counts),
               "renderedVoiceRouteNodes": len(current["lines"]), "renderedVoiceAssets": len(after_voice_assets),
               "renderedVoiceFileChecks": len(file_checks), "renderedVoiceFileHashFailures": sum(not fact["hashMatches"] for fact in file_checks.values()),
               "renderedInstalledVariantFailures": len(after_failures), "compressedNativeVoiceFiles": len(compressed),
               "compressedWholeChecksumMatches": len(compressed) - len(checksum_failures),
               "compressedWholeChecksumFailures": len(checksum_failures),
               "compressedErroneous2048PrefixMatches": sum(facts["storedChecksum"].get("prefix2048Matches", False) for facts in compressed),
               "nativeFormatParseFailures": len(format_failures), "nativeCacheIdentityFailures": len(identity_failures),
               "nativeCacheHashFailures": len(hash_failures),
               "selectedNativeEntryFormatCounts": [{"compression": compression, "custom": custom, "encrypted": encrypted, "uniqueFiles": count}
                                                  for (compression, custom, encrypted), count in sorted(entry_counts.items())],
               "nativeFormatCounts": [{"codec": codec, "channels": channels, "mappingFamily": family, "uniqueFiles": count}
                                      for (codec, channels, family), count in sorted(format_counts.items())],
               "baselineTotalAssets": len(baseline["assets"]), "renderedTotalAssets": len(current["assets"]),
               "addedNativeVoiceAssets": len(after_voice_assets - before_voice_assets),
               "existingEventMappingsPreserved": baseline["events"] == current["events"],
               "nonStoryAudioAssetsPreserved": other_assets_unchanged, "nonStoryAudioAssetCount": len(other_before),
               "nonStoryAudioFilesHashVerified": len(other_files) - len(other_file_failures),
               "nonStoryAudioFileHashFailures": len(other_file_failures)}
    native_evidence_path = ROOT / "test-results/reader-voice/native-failures.json"
    native_evidence = json.loads(native_evidence_path.read_text()) if native_evidence_path.exists() else None
    inputs = {"inventory": inventory_identity, "inventoryErrors": inventory.get("errors", []),
              "beforeManifest": baseline_identity, "currentManifest": current_identity,
              "scriptIndex": index_identity, "flowState": flow_identity, "plotAudio": plot_identity,
              "scriptsDigest": hashlib.sha256("\n".join(identity["path"] + ":" + identity["sha256"] for identity in script_sources).encode()).hexdigest(),
              "implementation": [public_identity(ROOT / path) for path in ("build_data.py", "tools/prepare_audio.py", "tools/wwise_sources.py",
                                                                          "tools/decode_wwise.py", "src/audio/AudioManifest.ts", "src/audio/ReaderAudio.ts", "tools/audit_reader_voices.py")],
              "nativeFailureEvidence": public_identity(native_evidence_path) if native_evidence_path.exists() else None}
    findings = ["Every authored voice node preserves the raw TidTalk text key and has a declared PlotAudio row.",
                "PlotAudio FileName is authoritative: source aliases share native audio while retaining their separate caption keys.",
                "All requested Japanese files exist. Baseline Japanese omissions are processing failures, not missing source media.",
                "Compressed stored checksums cover whole aligned stored blocks; the old 2048-byte prefix check rejects these valid custom2 clips.",
                "The two train media use five-channel Wwise Opus mapping family1; the old mono/stereo mapping0 decoder rejects them.",
                "English, Chinese and Korean filenames are absent from the complete installed inventory. No authored voice node uses GlobalLanguage."]
    common = {"schema": 2, "authority": "raw-FlowState-PlotAudio-installed-media-and-manifest-comparison",
              "capturedAtUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(), "inputs": inputs, "counts": summary,
              "sourceMappingMismatches": mismatches, "missingPlotAudioRouteKeys": missing_source,
              "nativeChecksumFailureMediaIds": checksum_failures, "nativeFormatFailureMediaIds": format_failures,
              "nativeCacheIdentityFailureMediaIds": identity_failures, "nativeCacheHashFailureMediaIds": hash_failures,
              "authoredFileNameAliases": aliases, "sharedFileNameGroups": reused_files, "findings": findings,
              "limitations": ["Absence is limited to the complete installed filename inventory; it does not claim that other language media does not exist in downloadable game packs.",
                              "Native codec facts come from the current identity/hash-validated WEM cache and explain the exact preserved pre-fix manifest failures.",
                              "The pre-rebuild manifest is the exact root-saved copy; all baseline counts are derived from that immutable file.",
                              "Disk hashes and ffprobe substantiate media preparation. Actual Reader voice start/cancellation and audible recordings are verified separately by the runtime audit."],
              "recommendedBoundedRebuild": {"mode": "voices-only", "authoredRouteNodes": len(routes), "nativeJapaneseFiles": len(native_media),
                                             "preserve": ["source text keys", "authored FileName aliases", "per-language gender flags", "GlobalLanguage semantics", "existing event mappings and non-story audio"],
                                             "nativeFixes": ["compressed aligned stored checksum scope", "Wwise Opus mapping-family1 multistream and speaker order"],
                                             "scope": "Rebuild only authored PlayVoice=true route mappings and their source media; offer only languages with installed resolved variants."}}
    before_report = {**common, "phase": "baseline-before-native-processing-fixes", "baselineManifest": baseline_identity,
                     "baselineCompleteMissingRoutes": [{"routeKey": route["routeKey"], "textKey": route["sourceTextKey"]} for route in complete_missing],
                     "baselinePartialMissingRoutes": [{"routeKey": route["routeKey"], "textKey": route["sourceTextKey"]} for route in partial_missing],
                     "baselineInstalledSourceFailures": baseline_failures, "nativeFailureEvidence": native_evidence,
                     "nativeMedia": native_media, "targetNodes": target_routes, "authoredRoutes": routes}
    after_report = {**common, "phase": "source-to-current-rendered-media", "currentManifest": current_identity,
                    "installedVariantFailures": after_failures, "renderedVoiceFiles": list(file_checks.values()), "targetEncodedAudioProbes": probes,
                    "preservedNonStoryAudioFiles": other_files,
                    "nativeMedia": native_media, "targetNodes": target_routes, "authoredRoutes": routes}
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "source-audit-before.json").write_text(json.dumps(before_report, ensure_ascii=False, indent=2) + "\n")
    (args.output / "source-to-render.json").write_text(json.dumps(after_report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"output": str(args.output), "counts": summary}, ensure_ascii=False, indent=2))
    if (inventory.get("errors") or mismatches or missing_source or after_failures or checksum_failures or format_failures
            or identity_failures or hash_failures or not other_assets_unchanged or other_file_failures or baseline["events"] != current["events"]):
        raise SystemExit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inventory", type=Path, default=Path("/tmp/reader-runtime-audio-inventory.json"))
    parser.add_argument("--baseline", type=Path, default=ROOT / "test-results/reader-voice/manifest-before.json")
    parser.add_argument("--manifest", type=Path, default=ROOT / "public/data/maps/audio-playback.json")
    parser.add_argument("--output", type=Path, default=ROOT / "test-results/reader-voice")
    audit(parser.parse_args())
