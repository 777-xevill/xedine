import type { HookStyle, MealMoment, Occasion } from './video-words';

/**
 * Bangla words for the videos, written by hand (ADR 0061, the founder's choice after the free AI wrote odd
 * Bangla such as "একসাথে খেলে অপবাদ নেই"). The autopilot posts without anyone reading it first, so the Bangla
 * on screen, in the voice and in the caption comes from here, matched to the video: the hook style, the meal
 * moment, the special day, one dish or several, the restaurant's tone, and a fact the restaurant's own sales
 * support (a best seller, a pair people order together). English stays AI-written.
 *
 * A line is the text and optional tags (space separated): a tone (friendly, premium, fun: only for those
 * tones), a dish count (one, two, three, many = two or more), a fact (best, pair: only when the sales show
 * it). "{dish}" is the main dish's Bangla name; a line with it is used only when the dish has one.
 * Lines never promise prices, delivery, hours, ingredients or "the best in town", and say nothing hot or
 * spicy, so they fit any dish, a falooda as well as a biryani.
 */
type Line = string | readonly [text: string, tags: string];
type Tone = 'friendly' | 'premium' | 'fun';

const HOOKS: Record<Exclude<HookStyle, 'moment'>, readonly Line[]> = {
  craving: [
    'খেতে মন চাইছে মজার কিছু?',
    'মুখে লেগে থাকার মতো স্বাদ চান?',
    'আজ একটু ভালো কিছু হয়ে যাক?',
    'জিভে জল আসছে তো?',
    'মনটা কি মজার কিছু খুঁজছে?',
    'আসল স্বাদের খোঁজে আছেন?',
    'শেষ কবে মন ভরে খেয়েছেন?',
    'পেট আর মন, দুটোই ভরাতে চান?',
    'খিদেটা কি জানান দিচ্ছে?',
    'স্বাদে ভরপুর কিছু খুঁজছেন?',
    'দেখেই খেতে ইচ্ছে করছে?',
    'চোখ সরাতে পারছেন না তো?',
    'এমন স্বাদ আগে পেয়েছেন?',
    ['ঘরোয়া স্বাদ মিস করছেন?', 'friendly'],
    ['ক্রেভিং শুরু হয়ে গেছে?', 'fun'],
    ['মন বলছে, আজ ট্রিট চাই?', 'fun'],
    ['একটু রাজকীয় স্বাদ হলে কেমন হয়?', 'premium'],
    ['বিশেষ কিছুর স্বাদ নিতে চান?', 'premium'],
    ['{dish} খেতে মন চাইছে?', 'one'],
    ['আজ {dish} হয়ে যাক?', 'one'],
    ['{dish}-এর কথা ভাবছেন?', 'one'],
    ['এগুলো দেখে খিদে পেল?', 'many'],
    ['কোনটা রেখে কোনটা খাবেন?', 'many'],
  ],
  claim: [
    'ঠিক যেমনটা আপনি ভালোবাসেন',
    'যত্নে রান্না, ভালোবাসায় পরিবেশন',
    'একবার খেলে বারবার আসবেন',
    'স্বাদেই আমাদের পরিচয়',
    'এই স্বাদ ভোলার নয়',
    'আমাদের রান্নাঘরের গর্ব',
    'প্রতিটি প্লেটে আসল স্বাদ',
    'মন ভরাবে, কথা দিলাম',
    'স্বাদে কোনো আপস নেই',
    'রান্না হয় মন দিয়ে',
    'এখানে স্বাদই শেষ কথা',
    'বারবার ফিরে আসার মতো স্বাদ',
    'স্বাদের নতুন ঠিকানা',
    ['এক প্লেটেই মুগ্ধতা', 'premium'],
    ['নিখুঁত রান্না, নিখুঁত স্বাদ', 'premium'],
    ['{dish}, আমাদের স্পেশাল', 'one'],
    ['একসাথে আরও জমে', 'many'],
    ['সবাই এটাই অর্ডার করে', 'one best'],
    ['সবার প্রিয় {dish}', 'one best'],
    ['এখানকার সবচেয়ে পছন্দের প্লেট', 'one best'],
    ['এই জুটিই সবার পছন্দ', 'many pair'],
    ['সবাই এই দুটো একসাথে নেয়', 'two pair'],
  ],
  invite: [
    'পুরো পরিবার নিয়ে চলে আসুন',
    'বন্ধুদের নিয়ে চলে আসুন',
    'খিদে নিয়ে আসুন, খুশি হয়ে ফিরুন',
    'আজই চলে আসুন',
    'একবার এসে দেখুন',
    'আপনার টেবিল তৈরি',
    'প্রিয়জনকে নিয়ে আসুন',
    'আজকের ট্রিট হোক আমাদের এখানে',
    'আড্ডা হোক আমাদের টেবিলে',
    'স্বাদ নিতে চলে আসুন',
    'অপেক্ষা করছি আপনার জন্য',
    'চলুন, আজ একসাথে খাই',
    'অর্ডার করুন, বাকিটা আমরা দেখছি',
    'পরিবারের সাথে মজার সময় হোক',
    ['আজ রান্না বন্ধ, চলে আসুন', 'friendly fun'],
    ['গ্যাং নিয়ে চলে আসুন', 'fun'],
    ['একটু সময় কাটান আমাদের সাথে', 'premium'],
    ['{dish} খেতে চলে আসুন', 'one'],
  ],
  tease: [
    'শেষেরটা মিস করবেন না',
    'শেষ পর্যন্ত দেখুন',
    'একটু অপেক্ষা করুন...',
    'আসল চমক শেষে',
    'চোখ রাখুন, আসছে...',
    'দেখার পর খিদে পাবেই',
    'স্ক্রল থামান, এটা দেখুন',
    'এক সেকেন্ড, এটা দেখুন',
    'না দেখলে মিস করবেন',
    'আজকের চমক রেডি',
    'একবার দেখুন, তারপর বলুন',
    'এটা দেখে থাকতে পারবেন?',
    ['দেখুন তো, চিনতে পারেন কি না', 'many'],
    ['সবচেয়ে মজারটা শেষে', 'many'],
    ['পরেরটা আরও ভালো', 'many'],
    ['এক এক করে দেখুন', 'many'],
  ],
  senses: [
    'টাটকা। সুস্বাদু। মন ভরানো।',
    'দেখতে সুন্দর, খেতে আরও',
    'এক কামড়েই প্রেম',
    'রঙে, গন্ধে, স্বাদে সেরা',
    'প্রতি কামড়ে আসল স্বাদ',
    'গন্ধেই মন ভরে যায়',
    'স্বাদটা মুখে লেগে থাকবে',
    'প্রথম কামড়েই বুঝবেন',
    'রঙিন, টাটকা, লোভনীয়',
    'লোভ সামলানো দায়',
    'দেখলেই জিভে জল',
    'চোখ জুড়ানো, মন ভরানো',
    'একদম টাটকা, একদম খাঁটি',
    ['স্বাদের বিস্ফোরণ!', 'fun'],
    ['রুচি আর স্বাদের মেলবন্ধন', 'premium'],
  ],
  mood: [
    'মন খারাপ? ভালো কিছু খান',
    'লম্বা দিন? নিজেকে একটু ট্রিট দিন',
    'ক্লান্ত? মজার খাবারে চাঙ্গা হন',
    'আজ নিজের জন্য কিছু করুন',
    'ভালো খাবার, ভালো মেজাজ',
    'রান্না করতে ইচ্ছে করছে না?',
    'আজ রান্নাঘরকে ছুটি দিন',
    'কাজের চাপ? একটু বিরতি নিন',
    'মনটা ভালো করে দেবে',
    'প্রিয় মানুষের সাথে প্রিয় খাবার',
    'নিজেকে ভালোবাসুন, ভালো খান',
    'খুশির খবর? এখানে উদযাপন করুন',
    ['ডায়েট কাল থেকে, আজ নয়', 'fun'],
    ['পরীক্ষা শেষ? সেলিব্রেশন হোক', 'fun'],
    ['বেতন পেয়েছেন? ট্রিট দিন', 'fun'],
    ['বন্ধুর ট্রিট পাওনা? এখানেই হোক', 'fun friendly'],
    ['ব্যস্ত দিনের শেষে একটু প্রশান্তি', 'premium'],
  ],
  dare: [
    'একা খেতে পারবেন তো?',
    'একটায় থামতে পারবেন না',
    'ভাগ দিতে মন চাইবে না',
    'লোভ সামলাতে পারবেন?',
    'না খেয়ে থাকতে পারবেন?',
    'একবার খেলে আবার আসবেনই',
    'সাহস থাকলে একবার ট্রাই করুন',
    'শেয়ার করবেন, নাকি একাই?',
    'বাজি, আবার আসবেন',
    'প্লেট খালি না করে উঠতে পারবেন না',
    'বন্ধুকে ট্যাগ করুন, ট্রিট সে দেবে',
    'ট্যাগ করুন যার সবসময় খিদে পায়',
    ['দেখি কে আগে শেষ করে', 'many'],
    ['সবগুলো একাই শেষ করবেন?', 'many'],
  ],
  pov: [
    'POV: নতুন প্রিয় খাবার পেয়ে গেলেন',
    'POV: বন্ধুরা বলল ট্রিট আপনার',
    'POV: ডায়েটের কথা ভুলে গেলেন',
    'POV: প্রথম কামড়ের পরের মুহূর্ত',
    'POV: খিদে পেটে মেনু দেখছেন',
    'POV: আজ রান্নাঘর ছুটিতে',
    'POV: প্লেট এল, ফোন পকেটে',
    'POV: ছবি তোলার আগেই শেষ',
    'POV: আপনি এখন আমাদের রেগুলার',
    'POV: সবাই একসাথে টেবিলে',
    'POV: খুঁজে পেলেন নতুন ঠিকানা',
    ['POV: প্রথমবার {dish} খেলেন', 'one'],
    ['POV: একটা চাইলেন, এল সবগুলো', 'many'],
  ],
};

const MOMENTS: Record<MealMoment, readonly Line[]> = {
  breakfast: [
    'সকালটা শুরু হোক মজায়',
    'নাস্তায় আজ নতুন কিছু?',
    'দিনের শুরুটা হোক স্বাদে',
    'সকালের খিদে? আমরা আছি',
    'ভালো নাস্তা, ভালো সকাল',
  ],
  lunch: [
    'দুপুরের খাবার, ঠিক এখানেই',
    'লাঞ্চ ব্রেকে চলে আসুন',
    'দুপুরটা জমে যাক স্বাদে',
    'দুপুরের খিদের সেরা উত্তর',
    'আজকের লাঞ্চ হোক স্পেশাল',
  ],
  snack: [
    'বিকেলের নাস্তা রেডি!',
    'বিকেলের খিদে? চলে আসুন',
    'বিকেলের আড্ডা জমবে এবার',
    'বিকেলটা হোক মজার',
    'বিকেলের আড্ডায় একটু স্বাদ',
  ],
  dinner: [
    'আজ রাতের খাবার এখানেই',
    'রাতের খাবারটা হোক স্পেশাল',
    'পরিবার নিয়ে আজ ডিনার?',
    'দিন শেষে ভালো খাবার চাই',
    'ডিনারের প্ল্যান তৈরি তো?',
  ],
  late: [
    'রাতে খিদে? আমরা আছি',
    'গভীর রাতের ক্রেভিং?',
    'রাত জাগা খিদের সঙ্গী',
    'মাঝরাতে মজার কিছু?',
    'রাতের খিদে মেটান স্বাদে',
  ],
};

/** Hooks for a special day (the greeting itself is shown and read separately). */
const OCCASION_HOOKS: Partial<Record<Occasion, readonly Line[]>> = {
  eid_fitr: [
    'ঈদের খুশি হোক স্বাদে ভরা',
    'ঈদের দিনে পরিবারের সাথে',
    'ঈদের আনন্দ ভাগ করে নিন',
    'সবাই মিলে ঈদের খাবার',
  ],
  eid_adha: [
    'কোরবানির ঈদে সবাই মিলে',
    'ঈদের দাওয়াত হোক এখানে',
    'ঈদের আনন্দ, ভাগাভাগি করে',
    'পরিবারের সাথে ঈদের স্বাদ',
  ],
  ramadan: [
    'রমজানে সবাই মিলে',
    'রমজানের বরকত ভাগ করুন',
    'রমজানে প্রিয়জনের সাথে',
    'ইফতারের টেবিল হোক পূর্ণ',
  ],
  iftar: [
    'ইফতারে সবাই মিলে',
    'ইফতারের টেবিল হোক পূর্ণ',
    'ইফতারের আয়োজন তৈরি',
    'প্রিয়জনের সাথে ইফতার',
  ],
  jummah: [
    'জুমার দিনে পরিবারের সাথে',
    'শুক্রবার মানেই ভালো খাবার',
    'জুমার পর সবাই মিলে',
    'ছুটির দিনে একসাথে খাওয়া',
    'শুক্রবারের দাওয়াত এখানে',
  ],
  boishakh: [
    'নতুন বছর, নতুন স্বাদ',
    'বৈশাখের আনন্দ পাতে',
    'শুভ নববর্ষে সবাই মিলে',
    'বৈশাখী আড্ডা জমুক',
  ],
  victory_day: ['বিজয়ের দিনে একসাথে', 'বিজয়ের আনন্দ ভাগ করুন', 'লাল-সবুজের দিনে সবাই মিলে'],
  independence_day: [
    'স্বাধীনতার দিনে একসাথে',
    'স্বাধীনতার আনন্দ সবাই মিলে',
    'লাল-সবুজের দিনে সবাই মিলে',
  ],
  new_year: ['নতুন বছর শুরু হোক স্বাদে', 'নতুন বছরে নতুন স্বাদ', 'বছরের প্রথম ট্রিট হোক এখানে'],
  christmas: ['বড়দিনের আনন্দ সবাই মিলে', 'বড়দিনে প্রিয়জনের সাথে', 'উৎসবের দিনে মজার খাবার'],
  puja: ['পূজার আনন্দ সবাই মিলে', 'উৎসবের দিনে মজার খাবার', 'পূজার আড্ডা জমুক এখানে'],
  valentine: [
    'প্রিয় মানুষের সাথে প্রিয় খাবার',
    'ভালোবাসার দিনে একসাথে',
    'দুজনের জন্য বিশেষ কিছু',
  ],
  mothers_day: ['মায়ের জন্য আজ একটু বিশেষ', 'মাকে নিয়ে চলে আসুন', 'আজ মায়ের ছুটি, ট্রিট আপনার'],
  weekend: ['ছুটির দিনে সবাই মিলে', 'উইকেন্ড মানেই ট্রিট', 'ছুটির দিনটা হোক মজার'],
};

const TAGLINES: readonly Line[] = [
  'আজ আমাদের রান্নাঘরে টাটকা রান্না',
  'যত্নে রান্না, সুন্দর পরিবেশন',
  'প্রতিবার আসল স্বাদ',
  'ভালো খাবার, ভালো মন',
  'স্বাদে ভরা প্রতিটি প্লেট',
  'খাঁটি স্বাদ, আন্তরিক আতিথেয়তা',
  'একবার খেলে মনে থাকবে',
  'আপনার প্রিয় স্বাদের ঠিকানা',
  'প্রতিদিন টাটকা, প্রতিদিন মজার',
  'পরিবারের সবার পছন্দের স্বাদ',
  'রান্নায় যত্ন, স্বাদে বিশ্বাস',
  'আমাদের রান্না, আপনার হাসি',
  'খেয়ে দেখুন, প্রেমে পড়বেন',
  'ছোট্ট ট্রিট, বড় খুশি',
  'আড্ডা আর স্বাদ, দুটোই এখানে',
  'খিদে মেটে, মনও ভরে',
  'টাটকা রান্না, খাঁটি স্বাদ',
  ['রুচিশীল রান্না, যত্নের পরিবেশন', 'premium'],
  ['প্রতিটি পদে নিখুঁত যত্ন', 'premium'],
  ['অভিজাত স্বাদের অভিজ্ঞতা', 'premium'],
  ['মজার খাবার, মজার মানুষ', 'fun'],
  ['খাও-দাও-ফুর্তি করো!', 'fun'],
  ['এক টেবিলে সবার পছন্দ', 'many'],
  ['দুটো একসাথে, মজা দ্বিগুণ', 'two'],
  ['তিন স্বাদ, এক আনন্দ', 'three'],
];

/** The question on a two- or three-dish video (versus, ring): the viewer picks or comments. */
const QUESTIONS: readonly Line[] = [
  'আপনি কোনটা নেবেন?',
  'আপনার প্রিয় কোনটা?',
  'কোনটা দিয়ে শুরু করবেন?',
  'কমেন্টে জানান আপনার পছন্দ',
  'কোনটা আগে খাবেন?',
  ['এটা না ওটা, কোনটা?', 'two'],
  ['আপনি কোন দলে?', 'two'],
  ['দুটোর মধ্যে আপনার পছন্দ?', 'two'],
  ['দুটোই নেবেন তো?', 'two'],
  ['তিনটার কোনটা আপনার?', 'three'],
  ['সবগুলোই চাই, তাই না?', 'three fun friendly'],
];

/** The combo's answer to "what is better than one?". */
const PUNCHES: readonly Line[] = [
  'একসাথে আরও মজা!',
  'দুটোই নিন!',
  'জুটিটা জমে গেছে!',
  'এক প্লেটে দ্বিগুণ মজা',
  'পারফেক্ট জুটি!',
  'দুইয়ে মিলে জমজমাট!',
];

/** Facebook/Instagram captions: {restaurant}, {dishes} (Bangla names joined), {greeting}. */
const CAPTIONS: readonly Line[] = [
  '{restaurant}-এ আজ {dishes}। যত্নে রান্না, টাটকা পরিবেশন। চলে আসুন অথবা এখনই অর্ডার করুন! 🍽️',
  '{dishes} খেতে মন চাইলে চলে আসুন {restaurant}-এ। একবার খেলে স্বাদটা মনে থাকবে। 😋',
  'খিদে নিয়ে আসুন, খুশি হয়ে ফিরুন। {restaurant}-এ অপেক্ষা করছে {dishes}। আজই চলে আসুন! 🍽️',
  'প্রিয়জনকে নিয়ে চলে আসুন {restaurant}-এ। আমাদের {dishes} আপনার জন্য তৈরি। ❤️',
  'স্বাদে কোনো আপস নেই। {restaurant}-এর {dishes} একবার চেখে দেখুন। অর্ডার করতে মেসেজ দিন! 📩',
  'আজকের ট্রিট হোক {restaurant}-এ। {dishes}, টাটকা আর মজার। দেরি না করে চলে আসুন! 🍴',
  'মন ভরে খেতে চাইলে {restaurant} আছে আপনার জন্য। আজকের পছন্দ {dishes}। এখনই অর্ডার করুন! 🍽️',
  ['{dishes} পছন্দ করে এমন বন্ধুকে ট্যাগ করুন! {restaurant}-এ একসাথে চলে আসুন। 😋', 'friendly fun'],
  [
    '{restaurant}-এ উপভোগ করুন {dishes}। প্রতিটি পদে যত্ন আর রুচির ছোঁয়া। আপনার টেবিল অপেক্ষা করছে। ✨',
    'premium',
  ],
  ['রুচিশীল স্বাদের খোঁজে? {restaurant}-এর {dishes} আপনার জন্য। আজই আসুন। ✨', 'premium'],
  ['ডায়েট কাল থেকে! আজ {restaurant}-এ {dishes} 😋 গ্যাং নিয়ে চলে আসুন!', 'fun'],
  ['ক্রেভিং শুরু? {restaurant}-এর {dishes} আছে আপনার জন্য 😎 এখনই অর্ডার করুন!', 'fun'],
];

const OCCASION_CAPTIONS: readonly string[] = [
  '{greeting}! এই আনন্দের দিনে সবাই মিলে খাওয়া হোক {restaurant}-এ। আমাদের {dishes} আপনার অপেক্ষায়। 🍽️',
  '{greeting}! প্রিয়জনের সাথে কাটুক সুন্দর সময়, সঙ্গে {restaurant}-এর {dishes}। চলে আসুন! 🍽️',
  '{greeting}! বিশেষ দিনটা হোক আরও বিশেষ, {restaurant}-এর {dishes} দিয়ে। পরিবার নিয়ে চলে আসুন। ❤️',
];

const HASHTAGS = ['#ফুডলাভার', '#খাবারদাবার', '#মজারখাবার', '#ফুডি', '#খাদ্যপ্রেমী'];

export interface BanglaContext {
  style: HookStyle;
  moment: MealMoment | null;
  tone: Tone;
  /** Dishes in the video (1–3). */
  dishes: number;
  occasion: Occasion | null;
  /** What the restaurant's own sales show about these dishes. */
  fact: 'best' | 'pair' | null;
  /** The main dish's Bangla name, if it has one. */
  dishName: string | null;
}

const textOf = (l: Line) => (typeof l === 'string' ? l : l[0]);
const tagsOf = (l: Line) => (typeof l === 'string' ? [] : l[1].split(' '));

function fits(l: Line, c: BanglaContext): boolean {
  const tags = tagsOf(l);
  const tones = tags.filter((t) => t === 'friendly' || t === 'premium' || t === 'fun');
  if (tones.length && !tones.includes(c.tone)) return false;
  if (tags.includes('one') && c.dishes !== 1) return false;
  if (tags.includes('many') && c.dishes < 2) return false;
  if (tags.includes('two') && c.dishes !== 2) return false;
  if (tags.includes('three') && c.dishes !== 3) return false;
  if (tags.includes('best') && c.fact !== 'best') return false;
  if (tags.includes('pair') && c.fact !== 'pair') return false;
  if (textOf(l).includes('{dish}') && !c.dishName?.trim()) return false;
  return true;
}

const norm = (x: string) => x.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
const mix = (seed: number, k: number) =>
  Math.imul((seed >>> 0) ^ (k * 0x9e3779b9), 2654435761) >>> 0;

/** One fitting line by the seed, skipping lines the restaurant used lately when others are left. */
function pick(
  lines: readonly Line[],
  c: BanglaContext,
  seed: number,
  recent: readonly string[],
): string {
  const fit = lines.filter((l) => fits(l, c)).map(textOf);
  const used = new Set(recent.map(norm));
  const fresh = fit.filter((t) => !used.has(norm(t)));
  const pool = fresh.length ? fresh : fit;
  const line = pool.length ? pool[seed % pool.length]! : '';
  return line.replaceAll('{dish}', c.dishName?.trim() ?? '');
}

/** The hook, punch, question and tagline in Bangla for one video. */
export function banglaWords(
  c: BanglaContext,
  seed: number,
  recent: readonly string[] = [],
): { hook: string; punch: string; question: string; tagline: string } {
  // A special day's hook on about two videos in three (Friday comes every week; the style keeps it fresh).
  const day = c.occasion ? OCCASION_HOOKS[c.occasion] : undefined;
  const hookLines =
    day && mix(seed, 1) % 3 !== 0
      ? day
      : c.style === 'moment'
        ? c.moment
          ? MOMENTS[c.moment]
          : HOOKS.craving
        : HOOKS[c.style];
  let hook = pick(hookLines, c, mix(seed, 2), recent);
  if (!hook) hook = pick(HOOKS.craving, c, mix(seed, 2), recent);
  return {
    hook,
    punch: pick(PUNCHES, c, mix(seed, 3), recent),
    question: pick(QUESTIONS, c, mix(seed, 4), recent),
    tagline: pick(TAGLINES, c, mix(seed, 5), recent),
  };
}

/** The Bangla caption: a fitting sentence or two, then the restaurant's tag and two food tags. */
export function banglaCaption(
  c: BanglaContext & { restaurant: string; dishNames: string; greeting: string | null },
  seed: number,
): string {
  const greeting = c.greeting?.trim();
  const body = (
    greeting
      ? OCCASION_CAPTIONS[mix(seed, 6) % OCCASION_CAPTIONS.length]!
      : pick(CAPTIONS, { ...c, dishName: 'x' }, mix(seed, 6), [])
  )
    .replaceAll('{greeting}', greeting ?? '')
    .replaceAll('{restaurant}', c.restaurant.trim())
    .replaceAll('{dishes}', c.dishNames.trim());
  const own = c.restaurant.replace(/[^\p{L}\p{M}\p{N}]+/gu, '');
  const a = mix(seed, 7) % HASHTAGS.length;
  const b = (a + 1 + (mix(seed, 8) % (HASHTAGS.length - 1))) % HASHTAGS.length;
  const tags = [own ? `#${own}` : null, HASHTAGS[a], HASHTAGS[b]].filter(Boolean).join(' ');
  return `${body}\n\n${tags}`;
}

/** Every distinct hook line (for the tests and the count the founder asked for). */
export function allBanglaHooks(): string[] {
  const all = [
    ...Object.values(HOOKS).flat(),
    ...Object.values(MOMENTS).flat(),
    ...Object.values(OCCASION_HOOKS).flat(),
  ].map(textOf);
  return [...new Set(all)];
}
