-- "Other" is a waste reason too: the cook picks it and types what happened in a free note.
create or replace function private.add_waste_reasons(p_org uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.reason_codes (org_id, kind, code, label, label_bn)
  values
    (p_org, 'waste', 'spoiled', 'Spoiled / expired', 'নষ্ট / মেয়াদোত্তীর্ণ'),
    (p_org, 'waste', 'overcooked', 'Overcooked or burnt', 'বেশি রান্না বা পুড়ে গেছে'),
    (p_org, 'waste', 'dropped', 'Dropped or spilled', 'পড়ে গেছে বা ছড়িয়ে গেছে'),
    (p_org, 'waste', 'leftover', 'Cooked but not sold', 'রান্না হয়েছে কিন্তু বিক্রি হয়নি'),
    (p_org, 'waste', 'returned', 'Returned by customer', 'গ্রাহক ফেরত দিয়েছেন'),
    (p_org, 'waste', 'staff_food', 'Staff food', 'স্টাফের খাবার'),
    (p_org, 'waste', 'other', 'Other', 'অন্যান্য')
  on conflict (org_id, kind, code) do nothing
$$;
select private.add_waste_reasons(o.id) from public.organizations o;
