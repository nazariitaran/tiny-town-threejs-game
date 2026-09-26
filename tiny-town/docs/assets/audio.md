# Audio (SFX) manifest

All sounds come from Kenney.nl audio packs, which are **CC0** (public domain, so attribution is optional; we credit anyway in `CREDITS.md`). The machine-readable version is `docs/assets/audio.json`, and `npm run gen:sfx` turns it into `src/audio/sfxTable.ts`.

- Format: MP3 (libmp3lame VBR `-q:a 4`), mono, 44.1 kHz. Kenney ships `.ogg`, but Safari's Web Audio support for Ogg Vorbis is unreliable, so everything is transcoded.
- Total payload: **23 files, ~52 KB**.
- Groups: `ui` (menus/toolbar) and `sfx` (world actions), both under one master gain (mute/volume).
- Build script: **`docs/assets/audio.build.py`** (versioned; see "Processing"). WP-07 rebuilt every file with it.

## Event → file table (WP-07)

Loudness is **one-shot LUFS**: the highest EBU R128 momentary (400 ms) loudness, measured with 0.6 s of silence padded on. For sounds shorter than 400 ms, this is the loudness of the whole hit. Standard integrated LUFS isn't meaningful for such short sounds. Peak is true peak in dBTP. All numbers are re-measured on the final MP3.

| Event | File(s) | Source (Kenney pack / file, layers) | Dur (ms) | Peak dBTP | LUFS (1-shot) | Notes |
|---|---|---|---|---|---|---|
| `ui-hover` | `ui-hover-1/2.mp3` | UI Audio / `rollover2`, `rollover5` | 53, 106 | −2.3, −6.6 | −32.1, −32.0 | Unchanged choice. Nothing emits it yet (WP-06 owns hover). |
| `ui-click` | `ui-click.mp3` | Interface Sounds / `click_001` | 95 | −1.6 | −30.0 | Unchanged choice. Now hits its −30 target (the old build missed by 2 dB). |
| `ui-open` / `ui-close` | `ui-open.mp3`, `ui-close.mp3` | Interface Sounds / `maximize_008`, `minimize_008` | 211, 210 | −13.9 | −29.0 | Unchanged. Nothing emits them yet (WP-06). |
| `place-path` | `place-path-1..3.mp3` | Impact Sounds / `impactGeneric_light_000/001/002` | 159, 115, 161 | −2.0 | −25.1, −25.0, −25.2 | Kept. The three variants now match within 0.2 LU (they were spread over 2.3 LU), and there's no sub-bass or end click. |
| `place-nature` | `place-nature-1..3.mp3` | `footstep_grass_000/001/003` + `drop_003` @ −6 dB | 171, 168, 158 | −2.0 | −25.8, −24.6, −25.6 | Kept. The `drop_003` layer is cut at 188 ms and used to leave an audible tick about 185 ms in. It now fades out. The trailing silence padding is trimmed (447 → ~165 ms). |
| `place-building` | `place-building-1..3.mp3` | `impactWood_heavy_000/002/004` + `impactWood_light_001/003/004` + `impactPlank_medium_000/002/003` @ −6 dB | 310 | −2.0 to −3.9 | −23.6, −23.0, −23.7 | **Reworked.** The heavy thunk alone had its spectral centroid at 70–110 Hz, which is almost inaudible on laptop/phone speakers (−41 to −46 LUFS above 250 Hz). A light wood knock and a quiet plank clatter now sit on top, which gives +10 to +14 dB above 250 Hz (−30 to −31.5). The file is high-passed at 80 Hz. |
| `place-prop` | `place-prop-1/2.mp3` | Impact Sounds / `impactWood_light_000/002` | 260 | −2.0 | −25.1, −25.2 | Kept for **fences** (wood on wood suits them). |
| `place-prop-metal` *(new)* | `place-prop-metal-1/2.mp3` | `impactMetal_light_001/004` + `impactWood_light_000/002` @ −6 dB, 0.22 s cap | 177, 162 | −4.9, −3.5 | −25.0 | **New:** a short metal clink with a small wooden body for the **lamppost and postbox**. The ring is trimmed so it doesn't hang. Needs the contract change (see below); `AudioManager` shims it meanwhile. |
| `rotate` | `rotate.mp3` | RPG Audio / `cloth2`, trimmed to 0.2 s | 191 | −6.2 | −28.0 | **Swapped.** The old `tick_004` source is truncated mid-transient: its peak is at 49 ms of 55, and it ends on a −0.17 sample, which is a click. It's replaced by a soft cloth swish, trimmed to start on the swish (−20 dB rel.) and kept quieter than placements. |
| `remove` | `remove-1/2.mp3` | `footstep_snow_001/002` + `impactPlank_medium_001/002` @ −5 dB | 382, 370 | −4.6, −5.3 | −24.1, −24.0 | **Reworked.** The snow crunch is kept (cosy) with a wooden plank clatter under it for "demolition" weight. The level drops 5 LU (it was the loudest sound in the game, 4 LU above building placement). At runtime the pitch varies by layer: object 0.92×, edge 1×, ground 1.06×. |
| `invalid` | `invalid.mp3` | Interface Sounds / `bong_001` | 119 | −4.8 | −26.0 | Kept, raised 1 LU. It's a 230 Hz bong, so it stays gentle on small speakers. |
| `undo` / `redo` | `undo-redo.mp3` (shared) | Interface Sounds / `back_004` | 89 | −5.2 | −29.0 | Kept. One file serves both: `undo` plays at 0.89× and `redo` at 1.12× (`playbackRate` in `audio.json`; `AudioManager` shims it until `gen:sfx` emits it). |

Suggested per-event runtime gain (`suggestedVolume`): UI 0.35–0.6; SFX 0.6–1.0. Building went from 0.9 to **1.0** and remove from 0.85 to **0.75**, so a new building is the loudest thing you do. These reach the game only after `npm run gen:sfx`.

### Every file, all events
- Leading silence is trimmed, with a 2 ms fade-in over the pre-roll. There's an 8 ms fade-out at the end and on every mixed layer, so no file or layer ends on a non-zero sample. Every final file ends within ±0.0005 of zero; before this, `rotate` ended at −0.105, `place-path-2` at −0.025 and `place-building-2` at −0.016.
- A 40 Hz high-pass (80 Hz for building) removes inaudible sub-bass. Before this, 10–22% of the energy in the building and path files was below 40 Hz, and it set the limiter's peaks.
- Several SFX (path, nature, prop) still land about 4 LU under their −21 target. Kenney impacts are one transient, and the script allows at most 4 dB of limiting rather than squashing the attack. The table lists what they actually measure.

## Listening test (WP-07)

**Caveat:** the WP-07 agent can't hear audio. The "listen test" was therefore done by capturing **the game's actual Web Audio output** during a real-input playtest, then judging it by waveform, spectrogram, level and playback-rate measurements. The files were also compared before and after. A human ear pass is still recommended; it takes about 20 s with `artifacts/wp-07/playtest-audio.wav`.

How the capture works: Playwright launches full Chromium and patches `AudioContext` so that everything connected to `destination` is also recorded by `MediaRecorder`, and every `AudioBufferSourceNode.start()` is logged with its `playbackRate`. It then plays through the game with the mouse and keyboard: category click, road click, road drag, trees, R rotate, two houses, a house on a road (invalid), a fence, a lamppost, a postbox, undo, redo, and bulldozing a house, a road tile and a tree. The outputs are in `artifacts/wp-07/`: `playtest-audio.wav/.webm`, `playtest-audio-spectrogram.png`, `playtest-levels.txt`, `playtest-starts.txt`, and the before/after waveform sheets `sfx-original-waveforms.png` / `sfx-final-waveforms.png`.

In-game peak 50 ms loudness (dBFS, full range / small-speaker proxy = 2× high-pass at 250 Hz), with the current `sfxTable` gains:

| Event | Full | Small speaker |
|---|---|---|
| place-building | −17.5 | −24 |
| remove | −19.5 | −24.5 |
| place-prop (fence) | −20.2 | −23.1 |
| place-nature | −20.5 | −21.6 |
| place-path | −21.1 | −21.6 |
| invalid | −22.7 | −29.9 |
| place-prop-metal | −23.2 | −23.5 |
| undo / redo | −23.6 / −23.2 | −25.9 / −25.2 |
| rotate | −26.3 | −27.0 |
| ui-click | −28.2 | −29.3 |

The UI sounds (click, undo/redo) sit below every placement sound. The building placement is now the loudest event.

## Processing (re-runnable)

The whole pipeline is **`docs/assets/audio.build.py`**, which needs Python 3 with numpy and scipy, plus ffmpeg. The packs are fetched into the git-ignored `assets-src/` as before:

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

# 2. build public/assets/audio/*.mp3 and docs/assets/audio.json (from the tiny-town root)
ASSETS_SRC="$PWD/assets-src" python3 docs/assets/audio.build.py
npm run gen:sfx      # integrator: refresh src/audio/sfxTable.ts
```

For each file, the script:
1. Decodes every layer to mono 44.1 kHz float and applies its gain, offset and optional length cap. Each layer gets its own end fade, then the layers are summed.
2. High-passes the mix (40 Hz by default).
3. Trims leading silence (−50 dBFS absolute, or a level relative to the peak for `rotate`) and adds a 2 ms fade-in. It applies the optional cap and fade-out, then an 8 ms end fade.
4. Gains to the one-shot LUFS target. UI files get plain gain capped at −1.5 dBTP. SFX get at most 4 dB of 3 ms lookahead limiting, and only when the peak ceiling blocks the target.
5. Encodes to MP3 (`-q:a 4`) and re-measures. `audio.json` holds these final numbers.

Change the `PLAN` list at the top of the script to swap sources, layers or targets. The original sourcing agent's `assets-src/audio-tools/build_audio.py` is superseded.

## Known gaps

- **Not heard by a human yet.** See the caveat above.
- `ui-hover`, `ui-open` and `ui-close` are never emitted by the current UI, so they were judged from the files only.
- `place-prop-metal` and the undo/redo `playbackRate` need integrator changes (`sfx.ts`, `tools.ts`, `gen-sfx-table.mjs`, `npm run gen:sfx`). `AudioManager` shims both until then.
- **MP3 encoder delay:** LAME adds roughly 25 ms of priming. Current Chrome, Firefox and Safari strip it through the LAME/Xing header, but end-to-end input-to-sound latency wasn't measured.
- **Ambience and music** are out of scope.
