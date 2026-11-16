import 'server-only';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import { seeded } from './seeded';
import type { VideoHit } from './video';

/**
 * The sound of a short video (ADR 0061):
 *
 *  - music: a clip from the library in assets/social-music, every track CC0 (public domain, no credit
 *    needed; the source and licence of each is in library.json), chosen by the video's mood;
 *  - food and motion sounds: a whoosh at each cut, a pop when a label pops, a stamp when a price or a
 *    word slams, sizzle under steam. They are synthesised by ffmpeg here, so they carry no licence at all;
 *  - the voice: the hook read by a free Microsoft neural voice through the open-source edge-tts tool (the
 *    founder's choice, ADR 0061: no account, no cost; it may stop working, and then a video simply has
 *    music only). Bangla and English, a woman's or a man's voice.
 *
 * The music ducks under the voice. Everything runs on the GitHub runner with ffmpeg-static and Python.
 */
export type Mood = 'upbeat' | 'chill' | 'cinematic' | 'playful' | 'warm' | 'festive';

export interface Track {
  id: string;
  file: string;
  title: string;
  artist: string;
  source: string;
  licence: 'CC0-1.0';
  moods: Mood[];
}

const MUSIC_DIR = join(process.cwd(), 'assets', 'social-music');

let library: Track[] | null = null;
export async function musicLibrary(): Promise<Track[]> {
  if (!library) {
    const file = join(MUSIC_DIR, 'library.json');
    library = existsSync(file)
      ? (JSON.parse(await readFile(file, 'utf8')) as { tracks: Track[] }).tracks
      : [];
  }
  return library;
}

/** A track for these moods (the first that has any), varied by the seed; null when the library is empty. */
export async function pickTrack(
  moods: Mood[],
  seed: string,
  avoid: readonly string[] = [],
): Promise<Track | null> {
  const all = await musicLibrary();
  const rnd = seeded(`music:${seed}`);
  for (const mood of moods) {
    const fit = all.filter((t) => t.moods.includes(mood));
    const fresh = fit.filter((t) => !avoid.includes(t.id));
    const pool = fresh.length ? fresh : fit;
    if (pool.length) return pool[Math.floor(rnd() * pool.length)]!;
  }
  return all.length ? all[Math.floor(rnd() * all.length)]! : null;
}

// ---------------------------------------------------------------------------------------------
// ffmpeg
// ---------------------------------------------------------------------------------------------

function ffmpegPath(): string {
  const p = ffmpegStatic as unknown as string | null;
  if (!p) throw new Error('ffmpeg_missing');
  return p;
}

function run(
  cmd: string,
  args: string[],
  timeoutMs = 120_000,
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stderr: String(e) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stderr });
    });
  });
}

/** Length of an audio file in seconds (from ffmpeg's own report), or null. */
async function durationOf(file: string): Promise<number | null> {
  const { stderr } = await run(ffmpegPath(), ['-hide_banner', '-i', file]);
  const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

/** The synthesised sounds (no recording, so no licence), made once per run. */
const SFX: Record<VideoHit['sound'], string> = {
  whoosh:
    'anoisesrc=d=0.5:c=pink:a=0.9:r=44100,highpass=f=250,lowpass=f=5000,afade=t=in:d=0.28:curve=qsin,afade=t=out:st=0.28:d=0.22,volume=0.55',
  pop: "aevalsrc='0.7*sin(2*PI*(500+1900*exp(-38*t))*t)*exp(-26*t)':d=0.18:s=44100",
  stamp:
    "aevalsrc='0.95*sin(2*PI*(52+140*exp(-22*t))*t)*exp(-8*t)+0.25*(random(0)*2-1)*exp(-40*t)':d=0.5:s=44100",
  sizzle:
    "anoisesrc=d=1.8:c=white:a=0.5:r=44100,highpass=f=3500,volume='0.35+0.3*gt(random(0),0.92)':eval=frame,afade=t=in:d=0.3,afade=t=out:st=1.2:d=0.6,volume=0.35",
};

async function sfxFiles(dir: string): Promise<Record<VideoHit['sound'], string>> {
  const out = {} as Record<VideoHit['sound'], string>;
  for (const [name, graph] of Object.entries(SFX) as [VideoHit['sound'], string][]) {
    const file = join(dir, `${name}.wav`);
    if (!existsSync(file)) {
      const r = await run(ffmpegPath(), [
        '-y',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        graph,
        '-ac',
        '2',
        file,
      ]);
      if (r.code !== 0) throw new Error(`sfx ${name}: ${r.stderr.slice(0, 200)}`);
    }
    out[name] = file;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The voice
// ---------------------------------------------------------------------------------------------

const VOICES: Record<'bn' | 'en', Record<'female' | 'male', string>> = {
  bn: { female: 'bn-BD-NabanitaNeural', male: 'bn-BD-PradeepNeural' },
  en: { female: 'en-US-AvaNeural', male: 'en-US-AndrewNeural' },
};

/**
 * The hook read aloud into `file` (mp3). Null when the tool is missing, the service refuses or it takes
 * too long: the video then goes out with music only.
 */
export async function speak(
  text: string,
  lang: 'bn' | 'en',
  gender: 'female' | 'male',
  file: string,
): Promise<{ file: string; seconds: number } | null> {
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, 160);
  if (!clean) return null;
  const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
  const args = [
    '-m',
    'edge_tts',
    '--voice',
    VOICES[lang][gender],
    '--rate=+6%',
    '--text',
    clean,
    '--write-media',
    file,
  ];
  // The free service now and then drops a request: one more try, then music only.
  let r = await run(python, args, 40_000);
  if (r.code !== 0) r = await run(python, args, 40_000);
  if (r.code !== 0 || !existsSync(file)) {
    const why = r.stderr.trim().split(/\r?\n/).pop() ?? 'failed';
    console.warn(`voice: ${why.slice(0, 200)}`);
    return null;
  }
  const seconds = await durationOf(file);
  return seconds && seconds > 0.3 ? { file, seconds } : null;
}

// ---------------------------------------------------------------------------------------------
// The mix
// ---------------------------------------------------------------------------------------------

export interface Score {
  seconds: number;
  track: Track | null;
  voice: { file: string; seconds: number } | null;
  /** When the voice starts (seconds). */
  voiceAt: number;
  hits: VideoHit[];
}

const HIT_VOLUME: Record<VideoHit['sound'], number> = {
  whoosh: 0.5,
  pop: 0.45,
  stamp: 0.6,
  sizzle: 0.55,
};

/** Lays music, sounds and voice under a silent MP4 and returns the finished MP4. */
export async function scoreVideo(silent: Uint8Array, score: Score): Promise<Uint8Array> {
  const dir = join(tmpdir(), `xedine-sound-${process.pid}`);
  await mkdir(dir, { recursive: true });
  const id = Math.random().toString(36).slice(2);
  const input = join(dir, `${id}-in.mp4`);
  const output = join(dir, `${id}-out.mp4`);
  await writeFile(input, silent);
  try {
    const sfx = await sfxFiles(dir);
    const T = score.seconds;
    const args = ['-y', '-loglevel', 'error', '-i', input];
    const chains: string[] = [];
    const mixIn: string[] = [];
    const fmt = 'aformat=sample_rates=44100:channel_layouts=stereo';
    let n = 1;
    let voiceLabel: string | null = null;
    if (score.voice) {
      args.push('-i', score.voice.file);
      const ms = Math.round(score.voiceAt * 1000);
      chains.push(
        `[${n}:a]${fmt},adelay=${ms}|${ms},volume=1.7,apad=whole_dur=${T},asplit=2[v1][v2]`,
      );
      voiceLabel = '[v1]';
      mixIn.push('[v2]');
      n++;
    }
    if (score.track) {
      args.push('-stream_loop', '-1', '-i', join(MUSIC_DIR, score.track.file));
      const music = `[${n}:a]${fmt},atrim=0:${T},asetpts=N/SR/TB,afade=t=in:d=0.4,afade=t=out:st=${(T - 1.3).toFixed(2)}:d=1.3,volume=0.62`;
      if (voiceLabel)
        chains.push(
          `${music}[m0]`,
          `[m0]${voiceLabel}sidechaincompress=threshold=0.02:ratio=9:attack=15:release=350[m]`,
        );
      else chains.push(`${music}[m]`);
      mixIn.push('[m]');
      n++;
    } else if (voiceLabel) {
      chains.push(`${voiceLabel}anullsink`);
    }
    for (const hit of score.hits.slice(0, 24)) {
      args.push('-i', sfx[hit.sound]);
      const ms = Math.max(0, Math.round(hit.t * 1000));
      chains.push(`[${n}:a]${fmt},adelay=${ms}|${ms},volume=${HIT_VOLUME[hit.sound]}[s${n}]`);
      mixIn.push(`[s${n}]`);
      n++;
    }
    if (mixIn.length === 0) return silent;
    chains.push(
      `${mixIn.join('')}amix=inputs=${mixIn.length}:normalize=0:duration=longest,alimiter=limit=0.9,atrim=0:${T}[a]`,
    );
    args.push(
      '-filter_complex',
      chains.join(';'),
      '-map',
      '0:v',
      '-map',
      '[a]',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      '-ar',
      '44100',
      '-t',
      String(T),
      '-movflags',
      '+faststart',
      output,
    );
    const r = await run(ffmpegPath(), args);
    if (r.code !== 0) throw new Error(`mix: ${r.stderr.slice(0, 300)}`);
    return new Uint8Array(await readFile(output));
  } finally {
    await rm(input, { force: true });
    await rm(output, { force: true });
  }
}

/** A scratch file for the voice. */
export function voiceFile(): string {
  return join(tmpdir(), `xedine-voice-${process.pid}-${Math.random().toString(36).slice(2)}.mp3`);
}
