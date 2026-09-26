# Audio Integration

Use this reference before planning or wiring a game's audio. Sources are procedural Web Audio synthesis, or files the user supplies or that come from a licensed/CC0 library. Record the license for every file.

## Audio Planning

Build an audio matrix from the events the game actually has:

| Category | Required events | Asset count | Loop? | Runtime group |
| --- | --- | ---: | --- | --- |
| UI | hover, confirm, cancel, pause, fail | 3-8 | no | ui |
| Movement | jump, dash, boost, landing, drift | 3-10 | sometimes | sfx |
| Interaction | pickup, hit, shield, score, checkpoint | 4-12 | no | sfx |
| Threat | enemy attack, warning, impact, boss cue | 4-12 | no | sfx |
| Ambience | room tone, wind, engines, crowd, weather | 1-4 | yes | ambience |
| Voice | announcer, boss, tutorial, combat barks | optional | no | voice |

Do not add dialogue, weapons, or ambience layers just to fill categories. Respect explicit silent or accessibility constraints.

## Sourcing

- Procedural: short UI clicks, blips, pickups, whooshes, and hums synthesize well from oscillators, filtered noise, and gain envelopes. Seed any randomness through the scaffold RNG.
- Files: keep one short file per event rather than one long mixed file, make loops seamless and test them looping in the game, and keep UI sounds quieter and shorter than gameplay SFX.
- Use variant pools for high-frequency events to avoid repetition, and normalize through volume groups rather than editing every file during iteration.

## Runtime Integration

Use a small audio manager instead of ad hoc `new Audio()` calls once a game has more than a few sounds:

- Load sounds after user gesture unlock.
- Maintain groups: `master`, `sfx`, `ui`, `ambience`, `voice`, `music`.
- Expose mute and per-group volume.
- Loop ambience through `AudioBufferSourceNode` or a library wrapper that handles loop restarts.
- Stop/dispose old sources when restarting scenes.
- Do not trigger the same high-volume SFX every frame; add cooldowns or variant pools.
- Pause/resume audio with the game pause state and page visibility.

Minimal Web Audio shape:

```ts
class GameAudio {
  private ctx = new AudioContext();
  private buffers = new Map<string, AudioBuffer>();
  private gains = new Map<string, GainNode>();

  async unlock() {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  async load(id: string, url: string) {
    const data = await fetch(url).then(r => r.arrayBuffer());
    this.buffers.set(id, await this.ctx.decodeAudioData(data));
  }

  play(id: string, group = 'sfx', volume = 1) {
    const buffer = this.buffers.get(id);
    if (!buffer) return;
    const source = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    source.buffer = buffer;
    source.connect(gain).connect(this.gains.get(group) ?? this.ctx.destination);
    source.start();
  }
}
```

## Runtime failure modes

Ambience loops stacking after a pause or restart · autoplay blocked because nothing unlocked the context from a user gesture · mute or volume reaching only some groups · decode/load errors swallowed silently · mobile Safari needing its own unlock path.
