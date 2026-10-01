#!/usr/bin/env python3
"""Rebuild Tiny Town's SFX (public/assets/audio/*.mp3) and docs/assets/audio.json from the Kenney CC0 packs.

WP-07 version of assets-src/audio-tools/build_audio.py (that script lives in the git-ignored assets-src/,
so this copy is the versioned source of truth). Run from the repo root:

    ASSETS_SRC=/abs/path/to/repo/assets-src python3 docs/assets/audio.build.py

Needs python3 + numpy + scipy and ffmpeg. The packs are fetched as described in docs/assets/audio.md.

Pipeline per output file (all in float, mono, 44.1 kHz):
 1. decode every layer, apply its gain (dB) / start offset (ms) / optional own fade-out, and sum;
 2. 2nd-order high-pass at HPF_HZ (removes DC offset and sub-bass that small speakers can't play but that
    eats headroom and drives the limiter);
 3. trim leading silence (below `trim` dBFS relative to the file's peak), optional max length + fade-out,
    and always a short END_FADE_MS fade-out so no file ends on a non-zero sample (click);
 4. gain to the event's one-shot LUFS target (max momentary loudness), capped at -1.5 dBTP for UI sounds;
    SFX may use at most MAX_LIMIT_DB of gentle lookahead limiting;
 5. encode libmp3lame VBR q4 and re-measure the MP3 (numbers in audio.json).
After a change here run `npm run gen:sfx` (integrator) so src/audio/sfxTable.ts picks up audio.json.
"""
import json, os, re, shutil, subprocess, sys
import numpy as np
from scipy.io import wavfile
from scipy.ndimage import maximum_filter1d, uniform_filter1d
from scipy.signal import butter, sosfilt

FF = shutil.which('ffmpeg') or '/opt/homebrew/bin/ffmpeg'
ROOT = os.getcwd()
SRC = os.environ.get('ASSETS_SRC', os.path.join(ROOT, 'assets-src'))
OUT = os.path.join(ROOT, 'public', 'assets', 'audio')
TMP = os.environ.get('AUDIO_TMP', os.path.join(SRC, 'audio-tools', '_tmp'))
SR = 44100
PEAK_CEIL = -1.5
MAX_LIMIT_DB = 4.0
LIMIT_CEIL_DB = -2.0
HPF_HZ = 40
END_FADE_MS = 8

def limit(x, sr, ceil_db, look_ms=3.0, release_ms=40.0):
    ceil = 10 ** (ceil_db / 20)
    L = max(1, int(sr * look_ms / 1000))
    a = np.abs(x)
    fwd = maximum_filter1d(a, size=2 * L, origin=-(L - 1) if L > 1 else 0, mode='constant')
    req = np.minimum(1.0, ceil / np.maximum(fwd, 1e-9))
    req = np.minimum(req, uniform_filter1d(req, size=L, mode='nearest'))
    rel = np.exp(-1.0 / (sr * release_ms / 1000))
    g = np.empty_like(req); cur = 1.0
    for i, r in enumerate(req):
        cur = r if r < cur else r + (cur - r) * rel
        g[i] = cur
    return np.clip(x * g, -ceil, ceil)

# A layer: (pack, file, gainDb=0, offsetMs=0, maxLenSec=None). A file spec: list of layers.
# Event: (event, group, targetLUFS, maxLenSec|None, fadeSec, trimDb, volume, pitchJitter, cooldownMs, [file specs], extra)
def L(pack, fn, db=0.0, at=0, maxlen=None):
    return (pack, fn, db, at, maxlen)
IS, IF, UA, RPG = 'impact-sounds', 'interface-sounds', 'ui-audio', 'rpg-audio'
POP = lambda: L(IF, 'drop_003.ogg', -6, 0, 0.17)   # the drop's own tail is cut at 188 ms: fade it (was a click)
PLAN = [
 ('ui-hover', 'ui', -32, None, 0, -50, 0.35, 0.04, 60, [[L(UA, 'rollover2.ogg')], [L(UA, 'rollover5.ogg')]], {}),
 ('ui-click', 'ui', -30, None, 0, -50, 0.6, 0.03, 50, [[L(IF, 'click_001.ogg')]], {}),
 ('ui-open', 'ui', -29, None, 0, -50, 0.55, 0.0, 120, [[L(IF, 'maximize_008.ogg')]], {}),
 ('ui-close', 'ui', -29, None, 0, -50, 0.55, 0.0, 120, [[L(IF, 'minimize_008.ogg')]], {}),
 ('place-path', 'sfx', -21, None, 0, -50, 0.7, 0.07, 45,
  [[L(IS, 'impactGeneric_light_000.ogg')], [L(IS, 'impactGeneric_light_001.ogg')], [L(IS, 'impactGeneric_light_002.ogg')]], {}),
 ('place-nature', 'sfx', -21, 0.45, 0.18, -50, 0.8, 0.08, 60,
  [[L(IS, 'footstep_grass_000.ogg'), POP()], [L(IS, 'footstep_grass_001.ogg'), POP()], [L(IS, 'footstep_grass_003.ogg'), POP()]], {}),
 # Heavy wood thunk (~90 Hz centroid) + a light wood knock on top so the drop still reads on laptop/phone
 # speakers, which roll off below ~200 Hz and made the heavy thunk alone almost inaudible. High-passed at
 # 80 Hz: the sub-bass below it is inaudible on small speakers but set the limiter's peak and so the level.
 ('place-building', 'sfx', -23, None, 0, -50, 1.0, 0.05, 80,
  [[L(IS, 'impactWood_heavy_000.ogg'), L(IS, 'impactWood_light_001.ogg', 0), L(IS, 'impactPlank_medium_000.ogg', -6, 10, 0.3)],
   [L(IS, 'impactWood_heavy_002.ogg'), L(IS, 'impactWood_light_003.ogg', 0), L(IS, 'impactPlank_medium_002.ogg', -6, 10, 0.3)],
   [L(IS, 'impactWood_heavy_004.ogg'), L(IS, 'impactWood_light_004.ogg', 0), L(IS, 'impactPlank_medium_003.ogg', -6, 10, 0.3)]], {'hpfHz': 80}),
 # Fences (wood): the light wood knocks were a good fit and are kept.
 ('place-prop', 'sfx', -21, None, 0, -50, 0.75, 0.06, 50,
  [[L(IS, 'impactWood_light_000.ogg')], [L(IS, 'impactWood_light_002.ogg')]], {}),
 # NEW event (contract request): lamppost / postbox. A short metal clink with a soft wooden body under it,
 # trimmed so the ring doesn't hang. Target is lower than wood: bright metal reads louder at equal LUFS.
 ('place-prop-metal', 'sfx', -25, 0.22, 0.12, -50, 0.7, 0.06, 50,
  [[L(IS, 'impactMetal_light_001.ogg'), L(IS, 'impactWood_light_000.ogg', -6)],
   [L(IS, 'impactMetal_light_004.ogg'), L(IS, 'impactWood_light_002.ogg', -6)]], {}),
 # Soft cloth swish (RPG Audio) instead of the 55 ms tick, whose source file is cut off mid-transient.
 ('rotate', 'sfx', -28, 0.2, 0.1, -20, 0.6, 0.05, 60, [[L(RPG, 'cloth2.ogg')]], {}),
 # Snow crunch + a wooden plank clatter underneath: still cosy, with more "demolition" weight.
 ('remove', 'sfx', -24, 0.42, 0.16, -50, 0.75, 0.06, 70,
  [[L(IS, 'footstep_snow_001.ogg'), L(IS, 'impactPlank_medium_001.ogg', -5)],
   [L(IS, 'footstep_snow_002.ogg'), L(IS, 'impactPlank_medium_002.ogg', -5)]], {}),
 ('invalid', 'ui', -26, None, 0, -50, 0.6, 0.0, 250, [[L(IF, 'bong_001.ogg')]], {}),
 ('undo-redo', 'ui', -29, None, 0, -50, 0.6, 0.02, 60, [[L(IF, 'back_004.ogg')]],
  {'variants': {'undo': {'playbackRate': 0.89}, 'redo': {'playbackRate': 1.12}},
   'note': 'One file shared by undo and redo: play undo at ~0.89x and redo at ~1.12x playbackRate.'}),
]

def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)

def decode(path):
    r = subprocess.run([FF, '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True)
    return np.frombuffer(r.stdout, dtype=np.float32).astype(np.float64)

def fade_out(x, sec):
    n = min(len(x), int(sec * SR))
    if n > 0: x[-n:] *= np.linspace(1, 0, n) ** 2
    return x

def measure(path):
    r = run([FF, '-hide_banner', '-nostats', '-v', 'verbose', '-i', path,
             '-af', 'apad=pad_dur=0.6,aresample=48000,ebur128=peak=true:framelog=verbose', '-f', 'null', '-'])
    e = r.stderr
    ms = [float(x) for x in re.findall(r' M:\s*([-\d.]+)', e)]
    tp = float(re.findall(r'True peak:\s+Peak:\s+([-\d.inf]+) dBFS', e, re.S)[-1])
    vd = run([FF, '-hide_banner', '-i', path, '-af', 'volumedetect', '-f', 'null', '-']).stderr
    maxv = float(re.findall(r'max_volume: ([-\d.]+) dB', vd)[-1])
    meanv = float(re.findall(r'mean_volume: ([-\d.]+) dB', vd)[-1])
    ns = int(re.findall(r'n_samples: (\d+)', vd)[-1])
    return dict(lufs=round(max(ms), 1), truePeak=tp, maxVolume=maxv, meanVolume=meanv, durationMs=round(ns / SR * 1000))

def build_file(layers, maxlen, fade, trim_db, hpf=HPF_HZ):
    parts = []
    for pack, fn, db, at, lmax in layers:
        y = decode(os.path.join(SRC, pack, 'Audio', fn)) * 10 ** (db / 20)
        # every layer gets its own end fade: several Kenney sources stop on a non-zero sample, which
        # clicks when another layer is still sounding underneath
        y = fade_out(y[: int(lmax * SR)].copy(), 0.03) if lmax else fade_out(y.copy(), END_FADE_MS / 1000)
        parts.append(np.concatenate([np.zeros(int(at * SR / 1000)), y]))
    x = np.zeros(max(len(p) for p in parts))
    for p in parts: x[: len(p)] += p
    x = sosfilt(butter(2, hpf, 'highpass', fs=SR, output='sos'), x)
    thr = np.abs(x).max() * 10 ** (trim_db / 20) if trim_db > -50 else 10 ** (-50 / 20)
    start = int(np.argmax(np.abs(x) > thr))
    x = x[max(0, start - int(0.002 * SR)):].copy()
    x[: int(0.002 * SR)] *= np.linspace(0, 1, int(0.002 * SR))   # 2 ms fade-in over the pre-roll
    if maxlen:
        x = x[: int(maxlen * SR)]
        x = fade_out(x, fade)
    # drop trailing near-silence, then a short fade so the file never ends on a non-zero sample
    tail = np.where(np.abs(x) > 10 ** (-70 / 20))[0]
    if len(tail): x = x[: tail[-1] + 1]
    return fade_out(x, END_FADE_MS / 1000)

def main():
    os.makedirs(OUT, exist_ok=True); os.makedirs(TMP, exist_ok=True)
    manifest = []
    for ev, group, target, maxlen, fade, trim_db, vol, jit, cd, files, extra in PLAN:
        outs, srcs, stats = [], [], []
        for i, layers in enumerate(files, 1):
            name = f'{ev}-{i}.mp3' if len(files) > 1 else f'{ev}.mp3'
            wav = os.path.join(TMP, name.replace('.mp3', '.wav'))
            x = build_file(layers, maxlen, fade, trim_db, extra.get('hpfHz', HPF_HZ))
            wavfile.write(wav, SR, x.astype(np.float32))
            m = measure(wav)
            max_lim = extra.get('maxLimitDb', MAX_LIMIT_DB)
            want = target - m['lufs']
            headroom = LIMIT_CEIL_DB - m['maxVolume']
            # limit only SFX whose loudness target is blocked by the true-peak ceiling
            limited = group == 'sfx' and want > (PEAK_CEIL - m['truePeak']) + 0.5
            if not limited:
                gain = round(min(want, PEAK_CEIL - m['truePeak']), 2)
                y = x * 10 ** (gain / 20)
            else:
                gain = min(want, headroom + max_lim)
                for _ in range(4):
                    y = limit(x * 10 ** (gain / 20), SR, LIMIT_CEIL_DB)
                    wavfile.write(wav + '.lim.wav', SR, y.astype(np.float32))
                    err = target - measure(wav + '.lim.wav')['lufs']
                    if abs(err) < 0.5 or gain >= headroom + max_lim: break
                    gain = min(gain + err, headroom + max_lim)
                gain = round(gain, 2)
            proc = wav + '.proc.wav'
            wavfile.write(proc, SR, y.astype(np.float32))
            mp3 = os.path.join(OUT, name)
            run([FF, '-y', '-hide_banner', '-loglevel', 'error', '-i', proc, '-ac', '1', '-ar', str(SR), '-codec:a', 'libmp3lame', '-q:a', '4', mp3])
            f = measure(mp3)
            stats.append(dict(file=f'/assets/audio/{name}', durationMs=f['durationMs'], peakDb=f['truePeak'], lufs=f['lufs'],
                              gainDb=gain, limited=limited, bytes=os.path.getsize(mp3)))
            outs.append(f'/assets/audio/{name}')
            srcs.append(' + '.join(f'{p} / {fn}' + (f' @ {db:g} dB' if db else '') for p, fn, db, _a, _m in layers))
        entry = dict(event=ev, files=outs, group=group, suggestedVolume=vol, pitchJitter=jit, cooldownMs=cd,
                     source='Kenney ' + '; Kenney '.join(srcs), license='CC0',
                     durationMs=max(s['durationMs'] for s in stats), peakDb=max(s['peakDb'] for s in stats),
                     lufs=round(sum(s['lufs'] for s in stats) / len(stats), 1), targetLufs=target,
                     perFile=[{k: s[k] for k in ('file', 'durationMs', 'peakDb', 'lufs')} for s in stats])
        extra = {k: v for k, v in extra.items() if k not in ('maxLimitDb', 'hpfHz')}
        if 'variants' in extra:  # undo/redo share one file: emit one audio.json entry per event
            for sub, v in extra['variants'].items():
                manifest.append(dict(entry, event=sub, playbackRate=v['playbackRate'], note=extra['note']))
        else:
            manifest.append(entry)
        for s in stats:
            print(f"{s['file']:36s} {s['durationMs']:4d}ms  LUFS {s['lufs']:6.1f} (tgt {target})  TP {s['peakDb']:5.1f}  gain {s['gainDb']:6.2f}{' L' if s['limited'] else '  '}  {s['bytes']}B")
    with open(os.path.join(ROOT, 'docs', 'assets', 'audio.json'), 'w') as fh:
        json.dump(manifest, fh, indent=2); fh.write('\n')
    print(f'wrote docs/assets/audio.json ({len(manifest)} events)')

if __name__ == '__main__':
    main()
