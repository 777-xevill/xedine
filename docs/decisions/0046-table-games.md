# ADR 0046 — Games at the table: alone, with friends or as a couple, on one phone or each on their own

- Date: 2026-11-12
- Changed by ADR 0047: the games no longer use the menu (pictures and questions are general), and three
  games were added. Read 0047 for what the games are now.
- Status: accepted (built at the founder's request: "when they sit at the table they can play multiple
  games: one person single, 2, 3, 4 people, and a couple game … each restaurant can add its name in the
  game like Kacchi Bhai"; answers: players choose one phone or separate phones; "amazing, not generic";
  no prizes; the owner names each game; "a game with a character, and a quiz; build all")

## Context
The table page (ADR 0045) gives the customer the menu, the member card, a Google review and the complaint
box. Customers wait 10–25 minutes for food. The founder wants them entertained, so they remember the
restaurant, without an app.

## Decision
1. **Six games on `/t/<token>/games`**, linked from the table page, with an original host character (a
   golden bun in a chef's hat, SVG in brand tokens) that presents, reacts and plays:
   - **Chef Catch** (1–4): move the character to catch the restaurant's own dish photos falling on a plate,
     gold stars for more, burnt ones cost a life; 45 seconds, 3 lives. Several players take turns on one
     phone or play at once on their own phones and compare.
   - **Dish Memory** (1–4): pairs of the restaurant's dish photos (food pictures fill in when there are too
     few photos); with friends, a pair keeps the turn and most pairs wins.
   - **Food Quiz** (1–4): a bank of 28 food questions (Bangladeshi food first) plus questions from the
     real menu ("which of these is on our menu?", "which dish costs ৳320 here?", the menu price). Alone:
     ten questions against a 15-second clock. One phone: turns. Own phones: everyone answers at once,
     faster right answers get a bonus.
   - **Tap Race** (2–4): dishes flash; tap only for the target dish. One phone lies flat with a corner per
     player (the top corners are turned to face their players); own phones are buzzers.
   - **Dish Duel** (1–2): three in a row with two dishes as pieces, best of three. Alone, against the
     character (minimax with one random move in four, so it can be beaten).
   - **Love Match** (couple): both answer the same six little questions ("tea or coffee?") and "which dish
     would you share tonight?" from the menu; the love score is matching answers out of all. On one phone
     the first partner's answers are hidden before the phone is handed over.
2. **One phone or separate phones, the players choose.** Separate phones use a **Supabase Realtime
   broadcast channel** named after the table link and a random room (`tq:<table token>:<room>`), with
   presence for who is there, and a table lobby channel (`tq:<table token>`) where a host announces the open
   game so friends at the same table see "Rifat is starting Food Quiz — Join". Anonymous, no table, nothing
   stored. The phone that made the game is the **host**: it runs the rules (`src/modules/games/*`, pure and
   tested), the timers and the character, and sends the whole state; other phones only send moves, which
   the host checks (`parseAction`) and attributes to the sender by who is connected. Moves that belong to
   the timers or the character are refused from other phones.
3. **No prizes** (founder's choice): game scores live on a phone and could be faked, and no points or money
   move. Nothing from a game reaches the database.
4. **The owner names each game and the character** (`org_settings.game_names`, e.g. "Kacchi Bhai Quiz",
   host "Kacchi Bhai"; empty keeps the default name) and switches games off (`org_settings.games_on`, on by
   default) on the Table QR page. Owner only (org_settings RLS); a manager sees whether games are on.
5. **Words in both languages, numbers from the menu.** Question banks and lines are in the message files
   (numbered entries, since the catalogue holds text only); a question travels as indexes, so each phone
   shows it in its own language. Prices are formatted from the menu; scores use Bangla digits in Bangla.

## Risks accepted
- Anyone who knows a table's link can join or watch a game at that table, or send fake game messages to it;
  it carries first names typed for the game and game moves only.
- Realtime free-tier limits (concurrent connections, messages a month) bound how many tables can play on
  separate phones at once; one-phone play needs no connection after the page loads.
