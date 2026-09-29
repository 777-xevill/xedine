/**
 * Starter questions on the new-chat screen, as `assistantPage.suggestions.*` message keys with the
 * router intent each must reach (tested). `money` ones need can_see_money, so only owners and
 * accountants are offered them.
 */
export const SUGGESTIONS = [
  ['sales', 'sales', false],
  ['stock', 'stock_low', false],
  ['top', 'top_items', false],
  ['leak', 'finding', true],
] as const;

export type SuggestionKey = (typeof SUGGESTIONS)[number][0];

export function suggestionKeys(canSeeMoney: boolean): SuggestionKey[] {
  return SUGGESTIONS.filter(([, , money]) => canSeeMoney || !money).map(([key]) => key);
}
