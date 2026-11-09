/**
 * A starting number of safe days for common Bangladeshi kitchen items, so the owner checks a filled-in list
 * instead of typing into dozens of empty boxes (ADR 0043 amendment). Nothing is saved until a person presses
 * Save. These are cautious kitchen rules of thumb for chilled or shelf storage, not law and not knowledge of
 * this kitchen. TODO(verify) the table with a food-safety adviser.
 *
 * Rules are checked in order, so a specific word comes before a general one. Latin words must match a whole
 * word ("dim" is not "dimsum"); Bangla matches inside a word, because endings attach to it (মুরগির).
 */
const RULES: { days: number; latin: string[]; bangla: string[] }[] = [
  { days: 2, latin: ['chicken', 'murgi', 'broiler'], bangla: ['মুরগি'] },
  {
    days: 2,
    latin: ['fish', 'mach', 'maach', 'ilish', 'rui', 'katla', 'tilapia', 'pangas'],
    bangla: ['মাছ', 'ইলিশ', 'তেলাপিয়া', 'পাঙ্গাস'],
  },
  { days: 2, latin: ['prawn', 'shrimp', 'chingri'], bangla: ['চিংড়ি'] },
  { days: 3, latin: ['beef', 'goru', 'mutton', 'khasi', 'lamb'], bangla: ['গরু', 'খাসি'] },
  { days: 2, latin: ['milk', 'dudh'], bangla: ['দুধ'] },
  { days: 5, latin: ['dhoi', 'doi', 'yogurt', 'yoghurt', 'curd'], bangla: ['দই'] },
  { days: 14, latin: ['cheese', 'paneer'], bangla: ['পনির'] },
  { days: 14, latin: ['egg', 'eggs', 'dim', 'deem'], bangla: ['ডিম'] },
  {
    days: 3,
    latin: ['bread', 'bun', 'buns', 'paratha', 'naan'],
    bangla: ['পাউরুটি', 'রুটি'],
  },
  {
    days: 3,
    latin: ['lettuce', 'coriander', 'dhonia', 'dhoney', 'mint', 'pudina', 'spinach', 'shak'],
    bangla: ['লেটুস', 'ধনে', 'পুদিনা', 'শাক'],
  },
  {
    days: 5,
    latin: ['tomato', 'tomatoes', 'cucumber', 'shosha', 'chili', 'chilli', 'morich', 'capsicum'],
    bangla: ['টমেটো', 'শসা', 'মরিচ'],
  },
  {
    days: 7,
    latin: ['carrot', 'cabbage', 'cauliflower', 'gajor'],
    bangla: ['গাজর', 'বাঁধাকপি', 'ফুলকপি'],
  },
  {
    days: 30,
    latin: ['onion', 'piyaj', 'peyaj', 'garlic', 'rosun', 'ginger', 'ada', 'potato', 'alu', 'aloo'],
    bangla: ['পেঁয়াজ', 'রসুন', 'আদা', 'আলু'],
  },
  { days: 30, latin: ['butter', 'mayonnaise', 'mayo'], bangla: ['মাখন', 'মেয়োনিজ'] },
  {
    days: 90,
    latin: ['ketchup', 'sauce', 'vinegar', 'flour', 'moida', 'maida', 'atta'],
    bangla: ['ময়দা', 'আটা'],
  },
  {
    days: 180,
    latin: ['rice', 'chal', 'chinigura', 'basmati', 'oil', 'tel', 'ghee', 'dal', 'daal', 'lentil'],
    bangla: ['চাল', 'তেল', 'ঘি', 'ডাল'],
  },
  {
    days: 180,
    latin: [
      'masala',
      'spice',
      'darchini',
      'cinnamon',
      'elachi',
      'cardamom',
      'jira',
      'cumin',
      'holud',
      'turmeric',
    ],
    bangla: ['মসলা', 'দারুচিনি', 'এলাচ', 'জিরা', 'হলুদ'],
  },
  { days: 365, latin: ['sugar', 'chini', 'salt', 'lobon'], bangla: ['চিনি', 'লবণ'] },
];

/** The suggested days for an item, or null when it is not a common one (the box stays empty). */
export function suggestShelfLife(name: string, nameBn?: string | null): number | null {
  const text = `${name} ${nameBn ?? ''}`.toLowerCase();
  const words = new Set(text.split(/[^a-z]+/).filter(Boolean));
  for (const rule of RULES) {
    if (rule.latin.some((w) => words.has(w)) || rule.bangla.some((w) => text.includes(w)))
      return rule.days;
  }
  return null;
}
