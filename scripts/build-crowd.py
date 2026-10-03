#!/usr/bin/env python3
"""Build the stadium crowd loop (public/assets/audio/stadium-crowd.mp3) from the owner's recording.

Run from the repo root, with the source at assets-src/owner/stadium-crowd-source.mp3 (docs/assets.md):

    ASSETS_SRC="$PWD/assets-src" python3 scripts/build-crowd.py

Needs python3 + numpy + scipy and ffmpeg.

The file is made periodic so the game can loop it inside the decoded buffer, clear of the silence an MP3
encoder pads on at both ends:
 1. decode to mono 44.1 kHz float, high-pass at 40 Hz;
 2. the last XFADE_S seconds are cross-faded (equal power) into the first, giving a loop of PERIOD_S;
 3. the first WRAP_S seconds of the loop are appended again, so sample(t + PERIOD_S) == sample(t) there;
 4. gain to TARGET_LUFS integrated, encode libmp3lame VBR q4 and verify the decoded MP3 is still periodic.
The runtime loops [LOOP_START_S, LOOP_START_S + PERIOD_S] (src/audio/CrowdLoop.ts keeps the same numbers).
"""
import os, re, shutil, subprocess, sys
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt

FF = shutil.which('ffmpeg') or '/opt/homebrew/bin/ffmpeg'
ROOT = os.getcwd()
SRC = os.environ.get('ASSETS_SRC', os.path.join(ROOT, 'assets-src'))
SOURCE = os.path.join(SRC, 'owner', 'stadium-crowd-source.mp3')
OUT = os.path.join(ROOT, 'public', 'assets', 'audio', 'stadium-crowd.mp3')
TMP = os.environ.get('AUDIO_TMP', os.path.join(SRC, 'audio-tools', '_tmp'))
SR = 44100
XFADE_S = 1.5
WRAP_S = 0.5
LOOP_START_S = 0.1
TARGET_LUFS = -23.0
PEAK_CEIL_DB = -1.5
HPF_HZ = 40

def run(cmd):
    return subprocess.run(cmd, check=True, capture_output=True, text=True)

def decode(path):
    wav = os.path.join(TMP, 'crowd-decode.wav')
    run([FF, '-y', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-c:a', 'pcm_f32le', wav])
    return wavfile.read(wav)[1].astype(np.float64)

def integrated_lufs(path):
    err = run([FF, '-hide_banner', '-nostats', '-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-']).stderr
    summary = err[err.rfind('Summary:'):]
    lufs = float(re.search(r'I:\s+(-?[\d.]+) LUFS', summary).group(1))
    peak = float(re.search(r'Peak:\s+(-?[\d.]+) dBFS', summary).group(1))
    return lufs, peak

def main():
    if not os.path.exists(SOURCE):
        sys.exit(f'missing {SOURCE}')
    os.makedirs(TMP, exist_ok=True)
    x = sosfilt(butter(2, HPF_HZ, 'highpass', fs=SR, output='sos'), decode(SOURCE))
    n, xf, wrap = len(x), int(XFADE_S * SR), int(WRAP_S * SR)
    period = n - xf
    k = np.linspace(0, 1, xf, endpoint=False)
    seam = x[n - xf:] * np.cos(k * np.pi / 2) + x[:xf] * np.sin(k * np.pi / 2)
    loop = np.concatenate([x[xf:n - xf], seam])
    assert len(loop) == period
    out = np.concatenate([loop, loop[:wrap]])

    wav = os.path.join(TMP, 'crowd-loop.wav')
    wavfile.write(wav, SR, out.astype(np.float32))
    lufs, peak = integrated_lufs(wav)
    gain = min(TARGET_LUFS - lufs, PEAK_CEIL_DB - peak)
    wavfile.write(wav, SR, (out * 10 ** (gain / 20)).astype(np.float32))
    run([FF, '-y', '-v', 'error', '-i', wav, '-c:a', 'libmp3lame', '-q:a', '4', '-ac', '1', '-ar', str(SR), '-map_metadata', '-1', OUT])

    # The decoded MP3 must repeat after one period from the loop start, whatever delay the codec added.
    y = decode(OUT)
    a = int(LOOP_START_S * SR)
    check = int(0.25 * SR)
    head, again = y[a:a + check], y[a + period:a + period + check]
    corr = float(np.corrcoef(head, again)[0, 1])
    step = float(abs(y[a + period] - y[a]))
    lufs, peak = integrated_lufs(OUT)
    print(f'{os.path.relpath(OUT, ROOT)}: {len(y) / SR:.3f} s decoded, period {period / SR:.3f} s ({period} samples), '
          f'loop {LOOP_START_S} to {LOOP_START_S + period / SR:.3f} s')
    print(f'  {lufs:.1f} LUFS integrated, {peak:.1f} dBTP, gain {gain:+.2f} dB, {os.path.getsize(OUT)} bytes')
    print(f'  seam: correlation {corr:.4f} over 250 ms, step {step:.5f} at the wrap')
    if corr < 0.98:
        sys.exit('the encoded loop is not periodic')

if __name__ == '__main__':
    main()
