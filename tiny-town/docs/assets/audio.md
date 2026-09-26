# Audio (SFX) manifest

All sounds come from Kenney.nl audio packs, which are **CC0** (public domain, so attribution is optional; we credit anyway in `CREDITS.md`). The machine-readable version is `docs/assets/audio.json`.

- Format: MP3 (libmp3lame VBR `-q:a 4`), mono, 44.1 kHz. Kenney ships `.ogg`, but Safari's Web Audio support for Ogg Vorbis is unreliable, so everything is transcoded.
- Total payload: **21 files, ~51 KB**.
- Groups: `ui` (menus/toolbar) and `sfx` (world actions). UI sounds are mastered roughly 5–10 dB quieter than placement sounds, and their `suggestedVolume` in `audio.json` is lower too.

These were chosen by name, pack description and measurement. Nobody has listened to them yet, so play each one in the game before calling it final (see "Weak fits").

## Event → file table

Loudness is **one-shot LUFS**: the highest EBU R128 momentary (400 ms) loudness, measured with 0.6 s of silence padded on. For a sound shorter than 400 ms this is its total loudness, and it doesn't depend on tail length. Standard "integrated" LUFS isn't meaningful for sounds shorter than 400 ms. Peak is true peak in dBTP.

| Event | File(s) | Source (Kenney pack / file) | Dur (ms) | Peak dBTP | LUFS (1-shot) | Why |
|---|---|---|---|---|---|---|
| `ui-hover` | `ui-hover-1.mp3`, `ui-hover-2.mp3` | UI Audio / `rollover2`, `rollover5` | 54, 109 | −2.4, −6.0 | −32.1, −32.0 | Kenney's purpose-made "rollover" ticks. These two have the lowest spectral centroid (~3 kHz), so they're the least bright. Mastered as the quietest sounds in the set. |
| `ui-click` | `ui-click.mp3` | Interface Sounds / `click_001` | 97 | −1.7 | −31.9 | Soft, short mouse-style click (~20 ms body) with a darker spectrum than the other clicks (~2.8 kHz). |
| `ui-open` | `ui-open.mp3` | Interface Sounds / `maximize_008` | 225 | −13.9 | −29.0 | A low (~400 Hz centroid) rising "maximize" swoosh that works well for opening a drawer. It is paired with `ui-close`. |
| `ui-close` | `ui-close.mp3` | Interface Sounds / `minimize_008` | 211 | −14.0 | −29.0 | The matching falling counterpart of `maximize_008`. |
| `place-path` | `place-path-1..3.mp3` | Impact Sounds / `impactGeneric_light_000/001/002` | 161, 115, 161 | −1.9, −2.0, −1.9 | −25.9, −28.2, −27.2 | Short, soft, low (~550–660 Hz centroid) generic taps that suit slabs or tarmac being laid. At about 115–160 ms they stay short enough for drag-painting. |
| `place-nature` | `place-nature-1..3.mp3` | Impact Sounds / `footstep_grass_000/001/003` + Interface Sounds / `drop_003` layered at −6 dB | 447 each | −2.1, −2.0, −2.0 | −27.3, −26.1, −27.3 | Grass footsteps give a soft rustle. A quiet "drop" bloop is mixed in for a small pop. Each is trimmed to 0.45 s with a 180 ms fade-out. |
| `place-building` | `place-building-1..3.mp3` | Impact Sounds / `impactWood_heavy_000/002/004` | 310 each | −2.0 | −23.7, −23.8, −23.7 | Deep (~200 Hz centroid) wooden thunks, for the "solid, satisfying" drop of a building. |
| `place-prop` | `place-prop-1..2.mp3` | Impact Sounds / `impactWood_light_000/002` | 263 each | −2.0, −1.8 | −25.4, −25.2 | Small, light wooden knocks for small props. |
| `rotate` | `rotate.mp3` | Interface Sounds / `tick_004` | 55 | −3.2 | −24.0 | A quick tick. It's very short, so rapid rotations don't smear together. |
| `remove` | `remove-1..2.mp3` | Impact Sounds / `footstep_snow_001/002` | 371 each | −2.0 | −19.5, −19.4 | Soft granular crunch (~900–1000 Hz centroid), a "crunch/poof" without a harsh destruction sound. |
| `invalid` | `invalid.mp3` | Interface Sounds / `bong_001` | 120 | −5.3 | −27.0 | A low (~500 Hz), short, soft "bong". It's gentler than Kenney's `error_*` buzzers and has a 250 ms cooldown. |
| `undo` / `redo` | `undo-redo.mp3` (shared) | Interface Sounds / `back_004` | 94 | −5.1 | −29.0 | Soft "back" blip. **One file serves both events:** play `undo` at `playbackRate ≈ 0.89` and `redo` at `≈ 1.12`. This is recorded per event in `audio.json`. |

Measured ranges:
- UI group: −32 to −27 LUFS (one-shot).
- SFX group: −28 to −19 LUFS (one-shot).
- True peak: every file is between −14.0 and −1.7 dBTP. None clip, none are silent (mean volume −27 to −17 dB), and none have leading silence (checked with `silencedetect` at −45 dB).
- Longest file: 447 ms.

### Suggested playback settings (also in `audio.json`)
- `pitchJitter` is the ± fraction applied to `playbackRate` per play. For example, 0.07 means a random rate in [0.93, 1.07]. Use it together with random variant selection. Drag-painting events have the highest jitter (path 0.07, nature 0.08).
- `cooldownMs` is the minimum gap before the same event plays again. It's 45 ms for `place-path` so drag-painting doesn't machine-gun, and 250 ms for `invalid` so it can't be spammed.
- `suggestedVolume` is a per-event gain on top of the mastered level. UI events use 0.35–0.6, SFX use 0.6–0.9.

## Processing (re-runnable)

The whole pipeline is scripted in **`assets-src/audio-tools/build_audio.py`**, which uses Python 3 with numpy and scipy, plus ffmpeg. Run it from the project root:

```bash
# 1. fetch + extract packs (zips and License.txt are kept in assets-src/<pack>/)
cd assets-src
for u in \
  https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip \
  https://kenney.nl/media/pages/assets/ui-audio/490d233f68-1677590494/kenney_ui-audio.zip \
  https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip \
  https://kenney.nl/media/pages/assets/digital-audio/216eac4753-1677590265/kenney_digital-audio.zip \
  https://kenney.nl/media/pages/assets/rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip; do
  n=$(basename "$u" .zip); n=${n#kenney_}; mkdir -p "$n"
  curl -sL -o "$n/$(basename "$u")" "$u" && (cd "$n" && unzip -oq "$(basename "$u")")
done
cd ..
# (zip URLs found with: curl -sL https://kenney.nl/assets/<pack> | grep -oE 'https://kenney.nl/media/pages/assets/[^"]+\.zip')

# 2. build public/assets/audio/*.mp3 (+ copies chosen originals to assets-src/audio-selected/,
#    writes a full per-file report to assets-src/audio-tools/_tmp/build-report.json)
python3 assets-src/audio-tools/build_audio.py
```

For each file the script does the following:

1. **Decode, downmix and trim.** It decodes to mono 44.1 kHz float and trims leading silence. It also optionally mixes in a layer, and optionally caps the length with a fade-out.
   ```bash
   ffmpeg -i SRC.ogg -ac 1 -ar 44100 \
     -af "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.004[,atrim=0:0.45,afade=t=out:st=0.27:d=0.18]" \
     -c:a pcm_f32le tmp.wav
   # place-nature layers the pop via:
   #   -filter_complex "[0:a]aformat=...mono[a];[1:a]aformat=...mono,volume=-6dB[b];[a][b]amix=inputs=2:normalize=0:duration=longest,<same -af chain>[o]"
   ```
2. **Measure.** One-shot LUFS is the max momentary loudness, and true peak is measured alongside it.
   ```bash
   ffmpeg -v verbose -i tmp.wav -af "apad=pad_dur=0.6,aresample=48000,ebur128=peak=true:framelog=verbose" -f null -   # take max "M:"
   ffmpeg -i tmp.wav -af volumedetect -f null -
   ```
3. **Gain to the event target.** Targets are −32 for hover, −30 for click, −29 for open, close and undo/redo, −27 for invalid, −24 for rotate, −21 for path, nature and prop, and −18 for building and remove.
   - UI sounds get a plain gain, capped so the true peak stays at or below −1.5 dBTP.
   - SFX that hit the peak ceiling first get **at most 4 dB** of gentle lookahead limiting: 3 ms lookahead, 40 ms release, −2 dBFS ceiling, implemented in numpy in the script. This takes the edge off the attack.
   - These Kenney impacts are essentially one transient, so several SFX land a few dB under target. The script chooses to accept that rather than squash them.
4. **Encode.**
   ```bash
   ffmpeg -i processed.wav -ac 1 -ar 44100 -codec:a libmp3lame -q:a 4 public/assets/audio/NAME.mp3
   ```
5. **Re-measure the final MP3.** These are the numbers in the table and in `audio.json`.

The per-file gains and before/after measurements are in `assets-src/audio-tools/_tmp/build-report.json`. Change the `PLAN` list at the top of the script to swap sources or targets.

## Weak fits and gaps

- **Not listened to.** Every choice was made from Kenney's naming plus measurements (duration, spectral centroid, loudness). Play each one in the game before calling it final.
- **`place-prop`** was asked for as a "click/clink". It uses light *wood* knocks, which suit fences but not metal props. If lampposts and postboxes need a metallic clink, try Impact Sounds `impactMetal_light_00x` or Interface Sounds `glass_002/003` (a short glass tink). Add those as a separate `place-prop-metal` event, not as random variants.
- **`place-nature`** is the quietest SFX (≈ −27 LUFS one-shot), because the grass footsteps are a small transient plus a very quiet rustle. The `drop_003` layer adds the "pop". If trees need more weight, use `suggestedVolume` 0.9–1.0 or layer `impactSoft_medium_00x`.
- **`remove`** uses a snow-footstep crunch. It's cosy, but it may feel light for bulldozing a whole townhouse. Alternatives: `impactPlank_medium_00x` (wood clatter, ~0.8 s, trim it) or `impactMining_00x` (rock crunch, ~0.9 s, trim to ~0.4 s).
- **`rotate`** is a 55 ms tick, which is functional but not a "swish". A cloth swish from RPG Audio (`cloth1`, trimmed to ~0.25 s) would be a softer alternative.
- **`undo` / `redo`** share one file, told apart by playback rate.
- **MP3 encoder delay.** LAME adds roughly 25 ms of priming samples. The LAME/Xing header lets ffmpeg and current Chrome, Firefox and Safari `decodeAudioData` strip it, so the files start on the transient. Older decoders may add a few ms of latency.
- **Ambience and music** were out of scope and are not included.
