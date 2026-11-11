# ADR 0047 — Games made of fun things, not the menu; three new games

- Date: 2026-11-12
- Status: accepted (built at the founder's request: "you add menu things, not other things, so change all
  menu things to other things so that they don't feel boring"; add new games)
- Changes ADR 0046 (the games used the restaurant's dishes, photos and prices everywhere)

## Context
The first six games (ADR 0046) were built from the restaurant's own menu: dish photos on the cards, menu and
price questions in the quiz, a dish to share in Love Match. The founder found that boring: the customer is
already looking at the menu. The games should feel like games.

## Decision
1. **No game reads the menu any more.** The games page no longer loads dishes, photos or prices. The menu
   stays on the table page, where it belongs.
2. **Pictures are emoji in five themes of twelve** (`src/modules/games/pictures.ts`: animals, space, sports,
   vehicles, party). Only emoji from the early sets are used, so budget Android phones show them. A game
   uses one theme at a time (Match Pairs, Tap Race, Three in a Row, Catch It!), so each play looks different.
   A "face" in a game is a number (the place in `PICTURES`); it travels as a number between phones.
3. **Words from the wider world.** Brain Quiz has 34 questions on Bangladesh (national symbols, days, rivers),
   animals, space, sports and small puzzles. Love Match has 15 "this or that" questions with no food. Both
   languages, kept as numbered entries in the message files.
4. **Three new games** (nine in all):
   - **Blur Guess** (1–4): a big picture starts very blurry and clears step by step; pick what it is from four
     clear pictures of the same theme. The earlier a right pick, the more points (100 down to 25). The
     phone that runs the game ticks the blur down, so the rules stay pure and testable.
   - **Would You Rather** (2–4): two choices; everyone picks one; those who picked what most of the table
     picked score a point (a split scores nobody). Separate phones: two big buttons, picks stay hidden until
     all are in. One phone: each player taps their own row.
   - **Spin the Wheel** (2–4): a wheel with a slice per person decides, for fun, who pays the bill, who orders
     next, who sings, who goes first. The result comes from a seed and the spin number, so every phone shows
     the same wheel stopping on the same person. No money moves.
5. **Default names change with it** (Catch It!, Brain Quiz, Blur Guess, Match Pairs, Tap Race, Three in a
   Row, Would You Rather, Spin the Wheel, Love Match). The owner can still rename every game and the host
   character; names are stored per game key (`org_settings.game_names`), so no migration was needed and the
   names an owner already set carry over (the keys catch, memory, quiz, race, duel, love are unchanged).
6. **Same rules as ADR 0046:** no prizes, nothing stored, host-run games over Realtime broadcast on separate
   phones, moves checked with `parseAction`, timer moves (`tick`) refused from other phones.

## Not done
- Sharing a score on WhatsApp/Facebook and a "top scores today" board were offered; the founder asked for
  games only.

## Risks accepted
Same as ADR 0046. Emoji look slightly different on each phone brand; that is fine for a game.
