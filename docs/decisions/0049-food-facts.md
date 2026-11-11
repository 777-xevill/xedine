# 0049 Food facts on the menu, with a helper for the customer

Status: accepted · 2026-11-14 · founder's choices asked with examples (AskUserQuestion)

## Context

The founder wants the table menu (ADR 0045) to show each dish's calories and protein, an AI helper that
helps the customer choose, and the owner or manager to fill the facts "with help of AI, as easy as possible".

## Decision

1. **The numbers are an AI guess that a person approves.** The founder chose this over adding up the dish's
   ingredients against a food table (offered as the recommended option) and over typing them by hand.
   "Fill with AI" on the new **Food facts** page (sidebar, owner and manager) guesses kcal, protein, carbs,
   fat and allergens for up to 24 dishes per tap (12 per AI call), using the dish's written ingredients
   (ADR 0037) when there are any. A guess is a draft (`dish_nutrition.status = 'ai_guess'`). Customers see
   nothing until the owner or a manager opens the dish, checks or changes the numbers and taps **Approve**,
   or taps **Approve all AI guesses**. That approval is the human step CLAUDE.md #1 and #4 need: the figure
   shown is the restaurant's stated value, not an AI number. Approving and removing are audited.
   A later guess never overwrites an approved dish.
2. **Writes are RPC-only.** `put_nutrition_guesses`, `approve_dish_nutrition`, `clear_dish_nutrition` check
   the owner/manager role in SQL. RLS allows owner, manager, kitchen and accountant to read and nobody to
   write directly. Allergens come from one fixed list (nuts, milk & ghee, egg, wheat/gluten, fish, prawn &
   crab, soy, sesame, beef), checked in the table and in the code.
3. **What the customer sees.** Each dish shows "850 kcal · 32 g protein". Tapping it shows carbs, fat and
   "Contains: …". The founder skipped the health-note question, so the menu shows no warning line.
4. **The helper**, above the menu:
   - *Quick picks* (high protein, light ≤ 500 kcal, up to ৳300) sort and filter the approved facts on the
     phone. No AI is involved, so they are instant and free, and they work without an AI key.
   - *"I don't eat"* chips hide dishes that contain a marked allergen **and dishes nobody has checked**,
     because "not marked" is not "safe".
   - *Ask* (when an AI provider is set): one question, in Bangla or English, to
     `/api/webhooks/menu-helper`. The model gets only this branch's menu lines with their approved facts
     and price. It names up to 3 dishes, which the page shows with their own approved figures. Any number
     in its words must appear in those lines (the assistant's numeric validator), or the words are dropped
     and only the dishes are shown. It gives no medical advice and points to the staff or a doctor.
     Spend is held by the gateway's daily cap per restaurant, plus a soft limit of 12 questions per table
     in 10 minutes per server instance.

## Not done

- The member card page's menu does not show food facts (only the table page does).
- Facts are per dish, not per size (variants).
- The helper keeps no chat history: each question is on its own.
- There is no check that a guess is close to the real dish. The owner's approval is the only check.
