# Google Play store listing — Xedine (ADR 0065)

Copy each block into Play Console → **Grow users → Store presence → Main store listing**. English is the
default language; add **Bangla (bn-BD)** under "Manage translations → Add your own translations" and paste the
Bangla blocks. Character limits are checked by `node docs/play-store/check-listing.mjs`.

Graphics are in [graphics/](graphics/):

| Play field | File | Size |
| --- | --- | --- |
| App icon | `graphics/icon-512.png` | 512 × 512 PNG |
| Feature graphic (English) | `graphics/feature-graphic-en.png` | 1024 × 500 |
| Feature graphic (Bangla) | `graphics/feature-graphic-bn.png` | 1024 × 500 |
| Phone screenshots (7, in order) | `graphics/phone-en-1-leaks.png` … `phone-en-7-growth.png` (Bangla: `phone-bn-*`) | 1080 × 1920 |
| 7-inch / 10-inch tablet screenshots | `graphics/tablet-en-*.png` (Bangla: `tablet-bn-*`) | 1920 × 1200 |

Screenshots are the public demo restaurant's sample data (`node android/tools/store-screenshots.mjs [--lang bn]`).

## English (default)

### App name (max 30)

<!-- name:en -->
Xedine – Restaurant POS & AI
<!-- /name:en -->

### Short description (max 80)

<!-- short:en -->
See where your restaurant loses money. Till, kitchen, stock, profit: one app.
<!-- /short:en -->

### Full description (max 4000)

<!-- full:en -->
Xedine shows a restaurant owner where money is leaking, with the proof in your own currency, and what to do next. Till, kitchen, stock, menu profit and social media live in one app, in Bangla or English.

MONEY LEAKS, WITH PROOF
• Voids, discounts, delivery commission and waste, ranked by what they cost you
• Every number comes from your own sales and purchase records, never guessed
• Menu profit: which dishes make money and which lose it, plate by plate

TILL (POS)
• Fast billing on a phone or tablet
• Keeps taking orders through power cuts and dropped internet, and sends them when the line is back
• Discounts and refunds need a manager PIN; every sensitive change is recorded
• Member cards, discount codes and table QR codes

KITCHEN SCREEN
• Orders reach the kitchen the moment they are taken
• Cooks tap when a dish is ready

STOCK AND PURCHASES
• Write the bazar list the way you would say it; Xedine turns it into purchases
• Stock goes down by itself as dishes are sold, from each dish's ingredients
• Warnings before an item runs out, and food safety checks with expiry dates

FORECAST AND SHOPPING LIST
• What tomorrow will sell, what to cook and what to buy
• Weather and holidays taken into account

AI ASSISTANT
• Ask "how were sales yesterday?" in Bangla or English
• Morning and evening briefs on Telegram
• AI drafts are saved for you to approve; it never changes your data on its own

SOCIAL MEDIA
• Posters and short videos made from your own dish photos
• Posted to your Facebook, Instagram and TikTok pages once you switch it on

CUSTOMERS AND BRANCHES
• Regular customers, feedback after the meal, complaints through a private QR form
• Several branches, managers by invitation, staff records, licences and VAT in order

MADE FOR YOUR RESTAURANT
• Works in Bangladesh, India, Pakistan, the Gulf, Malaysia, Singapore, the UK and the US, on your own clock, currency and tax name
• Every screen in Bangla and English
• Owners see costs and profit; managers and cashiers see only what their job needs

You need a Xedine account. Owners create one in the app in a minute; managers and cashiers join by the owner's invitation.

Help: support@xedine.org · https://xedine.org
<!-- /full:en -->

## বাংলা (bn-BD)

### App name (max 30)

<!-- name:bn -->
Xedine – রেস্টুরেন্ট POS ও AI
<!-- /name:bn -->

### Short description (max 80)

<!-- short:bn -->
রেস্টুরেন্টের টাকা কোথায় হারাচ্ছে দেখুন। ক্যাশ, কিচেন, স্টক ও লাভ—এক অ্যাপে।
<!-- /short:bn -->

### Full description (max 4000)

<!-- full:bn -->
Xedine রেস্টুরেন্টের মালিককে দেখায় টাকা কোথায় হারাচ্ছে—টাকার অঙ্কে, প্রমাণসহ—আর এরপর কী করবেন। ক্যাশ, কিচেন, স্টক, মেনুর লাভ আর সোশ্যাল মিডিয়া এক অ্যাপে, বাংলা বা ইংরেজিতে।

টাকা কোথায় হারাচ্ছে, প্রমাণসহ
• বাতিল অর্ডার, ছাড়, ডেলিভারি কমিশন আর অপচয়—কোনটায় কত খরচ, সেই ক্রমে
• প্রতিটি সংখ্যা আপনার নিজের বিক্রি আর কেনাকাটার হিসাব থেকে, আন্দাজে নয়
• মেনুর লাভ: কোন খাবারে লাভ, কোনটায় লোকসান—প্লেট ধরে ধরে

ক্যাশ (POS)
• ফোন বা ট্যাবলেটে দ্রুত বিল
• কারেন্ট বা ইন্টারনেট চলে গেলেও অর্ডার নেওয়া চলে, লাইন ফিরলে পাঠিয়ে দেয়
• ছাড় আর টাকা ফেরতে ম্যানেজারের পিন লাগে; সব গুরুত্বপূর্ণ পরিবর্তনের রেকর্ড থাকে
• মেম্বার কার্ড, ডিসকাউন্ট কোড আর টেবিলের QR কোড

কিচেন স্ক্রিন
• অর্ডার নেওয়ার সাথে সাথে কিচেনে পৌঁছে যায়
• খাবার তৈরি হলে রাঁধুনি এক চাপে জানান

স্টক আর বাজার
• মুখে যেভাবে বলেন সেভাবে বাজারের লিস্ট লিখুন; Xedine সেটাকে কেনাকাটায় সাজিয়ে দেয়
• খাবার বিক্রি হলে প্রতিটি খাবারের উপকরণ ধরে স্টক নিজে থেকেই কমে
• কোনো জিনিস ফুরানোর আগেই সতর্কবার্তা, মেয়াদসহ খাবারের নিরাপত্তা চেক

আগাম হিসাব আর বাজারের লিস্ট
• কাল কী বিক্রি হবে, কী রান্না করবেন, কী কিনবেন
• আবহাওয়া আর ছুটির দিন হিসাবে ধরা হয়

AI সহকারী
• বাংলা বা ইংরেজিতে জিজ্ঞেস করুন "গতকাল বিক্রি কেমন ছিল?"
• সকাল আর রাতের সারসংক্ষেপ Telegram-এ
• AI-এর খসড়া আপনার অনুমোদনের জন্য রাখা থাকে; নিজে থেকে আপনার তথ্য বদলায় না

সোশ্যাল মিডিয়া
• আপনার নিজের খাবারের ছবি দিয়ে পোস্টার আর ছোট ভিডিও
• চালু করলে আপনার Facebook, Instagram আর TikTok পেজে পোস্ট হয়

কাস্টমার আর ব্রাঞ্চ
• নিয়মিত কাস্টমার, খাওয়ার পর মতামত, QR দিয়ে গোপনে অভিযোগ
• একাধিক ব্রাঞ্চ, আমন্ত্রণে ম্যানেজার, স্টাফের রেকর্ড, লাইসেন্স আর ভ্যাট গুছিয়ে রাখা

আপনার রেস্টুরেন্টের জন্য তৈরি
• বাংলাদেশ, ভারত, পাকিস্তান, উপসাগরীয় দেশ, মালয়েশিয়া, সিঙ্গাপুর, যুক্তরাজ্য ও যুক্তরাষ্ট্রে—আপনার সময়, মুদ্রা আর করের নামে
• প্রতিটি স্ক্রিন বাংলা আর ইংরেজিতে
• খরচ আর লাভ দেখেন মালিক; ম্যানেজার আর ক্যাশিয়ার দেখেন শুধু তাঁদের কাজের অংশ

Xedine অ্যাকাউন্ট লাগবে। মালিক অ্যাপেই এক মিনিটে খুলতে পারেন; ম্যানেজার আর ক্যাশিয়ার যোগ দেন মালিকের আমন্ত্রণে।

সাহায্য: support@xedine.org · https://xedine.org
<!-- /full:bn -->

## Other listing fields

| Field | Value |
| --- | --- |
| App category | **Business** |
| Tags (up to 5) | Restaurant management, Point of sale, Inventory, Business management, Food & drink |
| Email | support@xedine.org |
| Website | https://xedine.org |
| Phone | (optional, leave empty) |
| Privacy policy | https://xedine.org/privacy |
| Delete account URL | https://xedine.org/data-deletion |
