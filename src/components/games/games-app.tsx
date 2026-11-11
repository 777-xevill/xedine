'use client';

import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  ArrowLeft,
  Brain,
  Dices,
  Eye,
  Grid3x3,
  Heart,
  Scale,
  Smartphone,
  Sparkles,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/form';
import { createClient } from '@/lib/db/supabase-browser';
import { formatNumber, type Locale } from '@/lib/i18n/format';
import { cn } from '@/lib/utils';
import { initCatch } from '@/modules/games/catch';
import {
  GAME_KEYS,
  isGameKey,
  PLAYERS,
  type GameKey,
  type NameKey,
  type Player,
} from '@/modules/games/catalog';
import { initDuel } from '@/modules/games/duel';
import {
  isRunnerOnly,
  parseAction,
  reduceGame,
  type GameAction,
  type GameState,
} from '@/modules/games/game';
import { initGuess } from '@/modules/games/guess';
import { initLove } from '@/modules/games/love';
import { initMemory } from '@/modules/games/memory';
import { themeFaces, THEMES } from '@/modules/games/pictures';
import { initQuiz } from '@/modules/games/quiz';
import { initRace } from '@/modules/games/race';
import { initRather } from '@/modules/games/rather';
import { pick as pickNumber, rng, shuffle } from '@/modules/games/random';
import { initWheel } from '@/modules/games/wheel';
import { CatchView } from './catch-view';
import { DuelView } from './duel-view';
import { GuessView } from './guess-view';
import { LoveView } from './love-view';
import { HostSays, Mascot } from './mascot';
import { MemoryView } from './memory-view';
import { PLAYER_BG } from './parts';
import { QuizView } from './quiz-view';
import { RaceView } from './race-view';
import { RatherView } from './rather-view';
import { WheelView } from './wheel-view';

/**
 * The games shell on the table page (ADR 0046). Pick a game, how many play and how: everyone on this one
 * phone, or each on their own phone. Separate phones talk through a Supabase Realtime broadcast channel
 * named after the table link (anonymous, nothing stored): the phone that made the game is the host, runs it
 * and sends the state; the others send their moves. Friends at the same table see the open game and join.
 */
export interface GamesAppProps {
  token: string;
  restaurant: string;
  names: Partial<Record<NameKey, string>>;
}

const ICONS: Record<GameKey, LucideIcon> = {
  catch: Sparkles,
  quiz: Zap,
  guess: Eye,
  memory: Brain,
  race: Users,
  duel: Grid3x3,
  rather: Scale,
  wheel: Dices,
  love: Heart,
};

const NAME_KEY = 'xedine.games.name';

interface Room {
  game: GameKey;
  players: Player[];
  status: 'lobby' | 'playing';
  state: GameState | null;
  v: number;
}

type Session =
  | { role: 'local'; game: GameKey }
  | { role: 'host'; game: GameKey; room: string }
  | { role: 'guest'; game: GameKey; room: string; hostId: string };

const LobbyMeta = z.object({
  room: z.string().regex(/^[a-z0-9]{8}$/),
  game: z.string(),
  host: z.string().max(40),
  hostId: z.string().max(64),
  n: z.number().int().min(0).max(8),
  open: z.boolean(),
});
type LobbyRoom = z.infer<typeof LobbyMeta> & { game: GameKey };

const PeerMeta = z.object({ id: z.string().max(64), name: z.string().max(40) });

const Wire = z.discriminatedUnion('k', [
  z.object({
    k: z.literal('state'),
    room: z.object({
      game: z.string(),
      players: z.array(PeerMeta).max(4),
      status: z.enum(['lobby', 'playing']),
      state: z.unknown(),
      v: z.number(),
    }),
  }),
  z.object({ k: z.literal('act'), from: z.string().max(64), action: z.unknown() }),
  z.object({ k: z.literal('hello'), from: z.string().max(64) }),
  z.object({ k: z.literal('bye') }),
]);

function readName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}
function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // A private window: the name is simply asked again next time.
  }
}

const cleanName = (v: string, fallback: string) =>
  v.replace(/\s+/g, ' ').trim().slice(0, 24) || fallback;
const roomId = () => Math.random().toString(36).slice(2, 10).padEnd(8, '0');

/** What the games need to know from the message files: how many questions and topics there are. */
interface Banks {
  quiz: number;
  love: number;
  rather: number;
  topics: number;
}

/** A new game, set up by the phone that runs it. */
function newGame(game: GameKey, players: Player[], local: boolean, banks: Banks): GameState {
  const seed = Math.floor(Math.random() * 2 ** 31);
  const next = rng(seed);
  const n = players.length;
  // Tap Race and Three in a Row use pictures of one theme.
  const themed = (count: number): number[] =>
    shuffle(themeFaces(pickNumber(THEMES.length, next)), next).slice(0, count);
  switch (game) {
    case 'catch':
      return initCatch(n, local);
    case 'memory':
      return initMemory(n, seed);
    case 'quiz':
      return initQuiz({
        mode: n === 1 ? 'solo' : local ? 'turns' : 'together',
        players: n,
        bankSize: banks.quiz,
        seed,
      });
    case 'guess':
      return initGuess(n === 1 ? 'solo' : local ? 'turns' : 'together', n, seed);
    case 'race': {
      const f = themed(5);
      return initRace(n, f, Math.floor(next() * f.length));
    }
    case 'duel': {
      const [a, b] = themed(2);
      return initDuel(n === 1, [a!, b!]);
    }
    case 'rather':
      return initRather(n, banks.rather, seed);
    case 'wheel':
      return initWheel(n, banks.topics, seed);
    case 'love':
      return initLove(local, banks.love, seed);
  }
}

export function GamesApp({ token, restaurant, names }: GamesAppProps) {
  const t = useTranslations('games');
  const locale = useLocale() as Locale;
  const sb = useMemo(() => createClient(), []);
  const [myId] = useState(() => crypto.randomUUID());
  const [myName, setMyName] = useState(() => (typeof window === 'undefined' ? '' : readName()));
  const [pick, setPick] = useState<GameKey | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [rooms, setRooms] = useState<LobbyRoom[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const channel = useRef<RealtimeChannel | null>(null);
  const lobby = useRef<RealtimeChannel | null>(null);

  const hostName = names.host ?? t('names.host');
  const gameName = (g: GameKey) => names[g] ?? t(`names.${g}`);
  const banks = useMemo<Banks>(
    () => ({
      quiz: Object.keys(t.raw('quiz.bank') as object).length,
      love: Object.keys(t.raw('love.bank') as object).length,
      rather: Object.keys(t.raw('rather.bank') as object).length,
      topics: Object.keys(t.raw('wheel.topics') as object).length,
    }),
    [t],
  );

  // The table's lobby: hosts announce their open game; everyone at the table sees it.
  useEffect(() => {
    const ch = sb.channel(`tq:${token}`, { config: { presence: { key: myId } } });
    ch.on('presence', { event: 'sync' }, () => {
      const list = Object.values(ch.presenceState())
        .flat()
        .flatMap((m) => {
          const p = LobbyMeta.safeParse(m);
          return p.success && isGameKey(p.data.game) && p.data.hostId !== myId
            ? [p.data as LobbyRoom]
            : [];
        });
      setRooms(list);
    }).subscribe();
    lobby.current = ch;
    return () => {
      lobby.current = null;
      void sb.removeChannel(ch);
    };
  }, [sb, token, myId]);

  const leave = useCallback(() => {
    const ch = channel.current;
    if (ch) {
      if (session?.role === 'host')
        void ch.send({ type: 'broadcast', event: 'm', payload: { k: 'bye' } });
      void sb.removeChannel(ch);
      channel.current = null;
    }
    void lobby.current?.untrack();
    setSession(null);
    setRoom(null);
    setPick(null);
  }, [sb, session]);

  // The host announces the game in the lobby while it waits for players (only when that changes).
  const hostRoom = session?.role === 'host' ? session.room : null;
  const hostGame = session?.game ?? null;
  const hostLabel = room?.players[0]?.name ?? '';
  const playerCount = room?.players.length ?? 0;
  const waiting = room?.status === 'lobby';
  useEffect(() => {
    if (!hostRoom || !hostGame) return;
    void lobby.current?.track({
      room: hostRoom,
      game: hostGame,
      host: hostLabel,
      hostId: myId,
      n: playerCount,
      open: waiting,
    });
  }, [hostRoom, hostGame, hostLabel, playerCount, waiting, myId]);

  // The host sends the room to everyone on every change.
  useEffect(() => {
    if (session?.role !== 'host' || !room) return;
    void channel.current?.send({ type: 'broadcast', event: 'm', payload: { k: 'state', room } });
  }, [session, room]);

  const openChannel = useCallback(
    (roomKey: string, me: Player, role: 'host' | 'guest', hostId: string) => {
      const ch = sb.channel(`tq:${token}:${roomKey}`, {
        config: { broadcast: { self: false }, presence: { key: me.id } },
      });
      let sawHost = role === 'host';
      const hostGone = () => {
        setNotice(t('hostLeft'));
        setSession(null);
        setRoom(null);
        void sb.removeChannel(ch);
        if (channel.current === ch) channel.current = null;
      };
      ch.on('broadcast', { event: 'm' }, ({ payload }) => {
        const msg = Wire.safeParse(payload);
        if (!msg.success) return;
        const m = msg.data;
        if (role === 'host') {
          if (m.k === 'hello') {
            setRoom((r) => (r ? { ...r, v: r.v + 1 } : r));
          } else if (m.k === 'act') {
            const action = parseAction(m.action);
            if (!action || isRunnerOnly(action)) return;
            setRoom((r) => {
              if (!r?.state || r.status !== 'playing') return r;
              const by = r.players.findIndex((p) => p.id === m.from);
              if (by < 0) return r;
              return { ...r, state: reduceGame(r.state, action, by), v: r.v + 1 };
            });
          }
        } else if (m.k === 'state') {
          if (!isGameKey(m.room.game)) return;
          setRoom({
            game: m.room.game,
            players: m.room.players,
            status: m.room.status,
            // Sent by this game's host, which made it with the same code.
            state: (m.room.state as GameState | null) ?? null,
            v: m.room.v,
          });
        } else if (m.k === 'bye') {
          hostGone();
        }
      });
      ch.on('presence', { event: 'sync' }, () => {
        const peers = Object.values(ch.presenceState())
          .flat()
          .flatMap((m) => {
            const p = PeerMeta.safeParse(m);
            return p.success ? [p.data] : [];
          });
        if (role === 'host') {
          // New players join while the game waits; the order they came in is their player number.
          setRoom((r) => {
            if (!r || r.status !== 'lobby') return r;
            const max = PLAYERS[r.game].max;
            const kept = r.players.filter(
              (p) => p.id === me.id || peers.some((x) => x.id === p.id),
            );
            const added = peers.filter((x) => !kept.some((p) => p.id === x.id));
            const players = [...kept, ...added].slice(0, max);
            return players.length === r.players.length &&
              players.every((p, i) => p.id === r.players[i]?.id)
              ? r
              : { ...r, players, v: r.v + 1 };
          });
        } else if (peers.some((p) => p.id === hostId)) {
          sawHost = true;
        } else if (sawHost) {
          hostGone();
        }
      });
      ch.subscribe((status) => {
        if (status !== 'SUBSCRIBED') return;
        void ch.track(me);
        if (role === 'guest')
          void ch.send({ type: 'broadcast', event: 'm', payload: { k: 'hello', from: me.id } });
      });
      channel.current = ch;
    },
    [sb, token, t],
  );

  useEffect(
    () => () => {
      if (channel.current) void sb.removeChannel(channel.current);
    },
    [sb],
  );

  const dispatch = useCallback(
    (action: GameAction, by?: number) => {
      if (!session) return;
      if (session.role === 'guest') {
        if (isRunnerOnly(action)) return;
        void channel.current?.send({
          type: 'broadcast',
          event: 'm',
          payload: { k: 'act', from: myId, action },
        });
        return;
      }
      setRoom((r) =>
        r?.state ? { ...r, state: reduceGame(r.state, action, by ?? 0), v: r.v + 1 } : r,
      );
    },
    [session, myId],
  );

  const startLocal = (game: GameKey, players: Player[]) => {
    setNotice(null);
    setSession({ role: 'local', game });
    setRoom({
      game,
      players,
      status: 'playing',
      state: newGame(game, players, true, banks),
      v: 1,
    });
  };

  const host = (game: GameKey, name: string) => {
    const me = { id: myId, name };
    const key = roomId();
    setNotice(null);
    setSession({ role: 'host', game, room: key });
    setRoom({ game, players: [me], status: 'lobby', state: null, v: 1 });
    openChannel(key, me, 'host', myId);
  };

  const join = (r: LobbyRoom, name: string) => {
    const me = { id: myId, name };
    setNotice(null);
    setSession({ role: 'guest', game: r.game, room: r.room, hostId: r.hostId });
    setRoom(null);
    openChannel(r.room, me, 'guest', r.hostId);
  };

  const again = () => {
    setRoom((r) =>
      r && session
        ? {
            ...r,
            status: 'playing',
            state: newGame(r.game, r.players, session.role === 'local', banks),
            v: r.v + 1,
          }
        : r,
    );
  };

  // ---- Playing -----------------------------------------------------------------------------------------
  if (session && room?.status === 'playing' && room.state) {
    const me = session.role === 'local' ? null : room.players.findIndex((p) => p.id === myId);
    if (me !== null && me < 0) {
      return (
        <Shell title={gameName(room.game)} onBack={leave}>
          <HostSays name={hostName} mood="sad">
            {t('alreadyStarted')}
          </HostSays>
        </Shell>
      );
    }
    const players =
      room.game === 'duel' && room.players.length === 1
        ? [...room.players, { id: 'host', name: hostName }]
        : room.players;
    const common = {
      dispatch,
      me,
      runner: session.role !== 'guest',
      players,
      hostName,
      locale,
      onAgain: again,
      onExit: leave,
    };
    const s = room.state;
    return (
      <Shell title={gameName(room.game)} onBack={leave}>
        {s.game === 'catch' ? <CatchView {...common} state={s} /> : null}
        {s.game === 'memory' ? <MemoryView {...common} state={s} /> : null}
        {s.game === 'quiz' ? <QuizView {...common} state={s} /> : null}
        {s.game === 'guess' ? <GuessView {...common} state={s} /> : null}
        {s.game === 'rather' ? <RatherView {...common} state={s} /> : null}
        {s.game === 'wheel' ? <WheelView {...common} state={s} /> : null}
        {s.game === 'race' ? <RaceView {...common} state={s} /> : null}
        {s.game === 'duel' ? <DuelView {...common} state={s} /> : null}
        {s.game === 'love' ? <LoveView {...common} state={s} /> : null}
      </Shell>
    );
  }

  // ---- Waiting room (separate phones) ------------------------------------------------------------------
  if (session && session.role !== 'local') {
    const players = room?.players ?? [];
    const { min, max } = PLAYERS[session.game];
    return (
      <Shell title={gameName(session.game)} onBack={leave}>
        <HostSays name={hostName} mood="wow">
          {session.role === 'host'
            ? t('waitFriends', { game: gameName(session.game) })
            : (notice ?? t('waitHostStart'))}
        </HostSays>
        <ul className="space-y-2">
          {players.map((p, i) => (
            <li
              key={p.id}
              className="game-pop flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-3"
            >
              <span aria-hidden className={cn('size-3 rounded-full', PLAYER_BG[i])} />
              <span className="font-semibold">{p.name}</span>
              {i === 0 ? <span className="text-xs text-secondary">{t('hostTag')}</span> : null}
            </li>
          ))}
        </ul>
        {session.role === 'host' ? (
          <>
            <p className="text-sm text-secondary">
              {t('howFriendsJoin', { max: formatNumber(max, locale) })}
            </p>
            <Button
              size="lg"
              className="w-full"
              disabled={players.length < Math.max(2, min)}
              onClick={() =>
                setRoom((r) =>
                  r
                    ? {
                        ...r,
                        status: 'playing',
                        state: newGame(r.game, r.players, false, banks),
                        v: r.v + 1,
                      }
                    : r,
                )
              }
            >
              {t('startWith', { n: formatNumber(players.length, locale) })}
            </Button>
          </>
        ) : null}
      </Shell>
    );
  }

  // ---- Set up a game -----------------------------------------------------------------------------------
  if (pick) {
    return (
      <Setup
        game={pick}
        title={gameName(pick)}
        hostName={hostName}
        myName={myName}
        locale={locale}
        onBack={() => setPick(null)}
        onLocal={(players) => startLocal(pick, players)}
        onHost={(name) => {
          setMyName(name);
          saveName(name);
          host(pick, name);
        }}
      />
    );
  }

  // ---- Home --------------------------------------------------------------------------------------------
  const open = rooms.filter((r) => r.open);
  return (
    <div className="space-y-5">
      <HostSays name={hostName} mood="happy">
        {t('hello', { host: hostName, restaurant })}
      </HostSays>
      {notice ? <p className="rounded-input bg-warning/10 px-3 py-2 text-sm">{notice}</p> : null}
      {open.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-lg font-bold">{t('openGames')}</h2>
          {open.map((r) => (
            <JoinRow
              key={r.room}
              label={t('openGame', { host: r.host, game: gameName(r.game) })}
              myName={myName}
              onJoin={(name) => {
                setMyName(name);
                saveName(name);
                join(r, name);
              }}
            />
          ))}
        </section>
      ) : null}
      <section className="grid grid-cols-2 gap-3">
        {GAME_KEYS.map((g, i) => {
          const Icon = ICONS[g];
          const { min, max } = PLAYERS[g];
          return (
            <button
              key={g}
              type="button"
              onClick={() => setPick(g)}
              className="game-pop flex flex-col items-start gap-2 rounded-sheet border border-line bg-surface p-4 text-start shadow-soft transition active:scale-[0.97]"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <span
                className={cn(
                  'flex size-11 items-center justify-center rounded-card text-on-action',
                  PLAYER_BG[i % 4],
                )}
              >
                <Icon aria-hidden className="size-6" />
              </span>
              <span className="font-bold leading-tight">{gameName(g)}</span>
              <span className="text-xs text-secondary">{t(`about.${g}`)}</span>
              <span className="mt-auto rounded-full bg-surface-elevated px-2 py-0.5 text-xs font-semibold">
                {g === 'love'
                  ? t('couple')
                  : min === max
                    ? t('playersN', { n: formatNumber(min, locale) })
                    : t('playersRange', {
                        min: formatNumber(min, locale),
                        max: formatNumber(max, locale),
                      })}
              </span>
            </button>
          );
        })}
      </section>
    </div>
  );
}

function Shell({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  const t = useTranslations('games');
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label={t('back')}>
          <ArrowLeft aria-hidden className="size-5" />
        </Button>
        <h2 className="min-w-0 truncate text-xl font-extrabold">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function JoinRow({
  label,
  myName,
  onJoin,
}: {
  label: string;
  myName: string;
  onJoin: (name: string) => void;
}) {
  const t = useTranslations('games');
  const [name, setName] = useState(myName);
  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-card border border-line bg-surface p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onJoin(cleanName(name, t('playerN', { n: '2' })));
      }}
    >
      <p className="w-full text-sm font-semibold">{label}</p>
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={24}
        placeholder={t('yourName')}
        aria-label={t('yourName')}
        className="min-w-0 flex-1"
      />
      <Button type="submit">{t('join')}</Button>
    </form>
  );
}

function Setup({
  game,
  title,
  hostName,
  myName,
  locale,
  onBack,
  onLocal,
  onHost,
}: {
  game: GameKey;
  title: string;
  hostName: string;
  myName: string;
  locale: Locale;
  onBack: () => void;
  onLocal: (players: Player[]) => void;
  onHost: (name: string) => void;
}) {
  const t = useTranslations('games');
  const { min, max } = PLAYERS[game];
  const [count, setCount] = useState(Math.max(min, game === 'love' ? 2 : 1));
  const [how, setHow] = useState<'one' | 'own'>('one');
  const [names, setNames] = useState<string[]>(() => [myName, '', '', '']);
  const couple = game === 'love';
  const label = (i: number) =>
    couple
      ? t('partnerN', { n: formatNumber(i + 1, locale) })
      : t('playerN', { n: formatNumber(i + 1, locale) });

  return (
    <Shell title={title} onBack={onBack}>
      <HostSays name={hostName} mood="happy">
        {t(`intro.${game}`)}
      </HostSays>
      {max > 1 && min !== max ? (
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">{t('howMany')}</legend>
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: max - min + 1 }, (_, k) => min + k).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setCount(n)}
                className={cn(
                  'flex min-h-14 flex-col items-center justify-center rounded-card border-2 font-black',
                  count === n ? 'border-purple bg-purple/10' : 'border-line bg-surface',
                )}
              >
                <span className="text-xl">{formatNumber(n, locale)}</span>
                <span className="text-[0.65rem] font-semibold text-secondary">
                  {n === 1 ? t('solo') : t('players')}
                </span>
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}
      {count > 1 ? (
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">{t('howPlay')}</legend>
          <div className="grid grid-cols-2 gap-2">
            {(['one', 'own'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setHow(k)}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-card border-2 p-3 text-center',
                  how === k ? 'border-purple bg-purple/10' : 'border-line bg-surface',
                )}
              >
                <span className="flex">
                  <Smartphone aria-hidden className="size-6" />
                  {k === 'own' ? (
                    <Smartphone aria-hidden className="-ms-2 size-6 opacity-70" />
                  ) : null}
                </span>
                <span className="text-sm font-bold">
                  {t(k === 'one' ? 'onePhone' : 'ownPhones')}
                </span>
                <span className="text-xs text-secondary">
                  {t(k === 'one' ? 'onePhoneHint' : 'ownPhonesHint')}
                </span>
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (count > 1 && how === 'own') {
            onHost(cleanName(names[0] ?? '', label(0)));
            return;
          }
          onLocal(
            Array.from({ length: count }, (_, i) => ({
              id: `p${i}`,
              name: cleanName(names[i] ?? '', count === 1 ? t('you') : label(i)),
            })),
          );
        }}
      >
        {Array.from({ length: count > 1 && how === 'own' ? 1 : count }, (_, i) => (
          <div key={i}>
            <Label htmlFor={`g-name-${i}`}>
              {count > 1 && how === 'own' ? t('yourName') : label(i)}
            </Label>
            <Input
              id={`g-name-${i}`}
              value={names[i] ?? ''}
              maxLength={24}
              placeholder={count === 1 ? t('you') : label(i)}
              onChange={(e) =>
                setNames((list) => list.map((v, k) => (k === i ? e.target.value : v)))
              }
            />
          </div>
        ))}
        <Button type="submit" size="lg" className="w-full">
          {count > 1 && how === 'own' ? t('createGame') : t('start')}
        </Button>
      </form>
      <div className="flex justify-center">
        <Mascot mood="cheer" className="size-24" />
      </div>
    </Shell>
  );
}
