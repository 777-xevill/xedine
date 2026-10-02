-- ADR 0025 amendment: a purchaser who buys something not yet in the ingredient list should not be
-- blocked. A chat draft line may carry `new_ingredient: {name, base}` instead of an ingredient_id; the
-- ✅ tap that confirms the draft then also creates that ingredient (once, by name) and records the
-- purchase against it. Nothing is created before the tap; the purchaser needs no ingredient-editing
-- role (the owner can rename or merge later); creation is audited under the purchaser's name.

create or replace function public.chat_confirm_purchase_draft(
  p_channel public.chat_channel, p_external_id text, p_draft uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  l public.chat_links;
  d public.purchase_drafts;
  x jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_ing uuid;
  v_name text;
  v_base public.base_unit;
  v_existing public.ingredients;
begin
  if not private.is_service_role() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  l := private.chat_link_for(p_channel, p_external_id);
  d := private.chat_own_draft(l, p_draft);
  if jsonb_typeof(d.extracted -> 'lines') <> 'array' or jsonb_array_length(d.extracted -> 'lines') = 0
     or exists (
       select 1 from jsonb_array_elements(d.extracted -> 'lines') y
        where coalesce(jsonb_array_length(y -> 'flags'), 0) > 0
           or (nullif(y ->> 'ingredient_id', '') is null and jsonb_typeof(y -> 'new_ingredient') <> 'object')
           or (y ->> 'qty_base') is null or (y ->> 'line_total_poisha') is null)
  then
    raise exception 'this draft needs fixing before it can be confirmed' using errcode = 'invalid_parameter_value';
  end if;
  perform private.act_as(l.user_id);
  if not private.can_access_branch_role(l.org_id, l.branch_id, array['owner', 'purchaser']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;

  for x in select * from jsonb_array_elements(d.extracted -> 'lines') loop
    v_ing := nullif(x ->> 'ingredient_id', '')::uuid;
    if v_ing is null then
      v_name := left(btrim(x -> 'new_ingredient' ->> 'name'), 120);
      v_base := (x -> 'new_ingredient' ->> 'base')::public.base_unit;
      if coalesce(v_name, '') = '' or v_base is null then
        raise exception 'this draft needs fixing before it can be confirmed' using errcode = 'invalid_parameter_value';
      end if;
      select * into v_existing from public.ingredients
       where org_id = l.org_id and (lower(name) = lower(v_name) or lower(coalesce(name_bn, '')) = lower(v_name))
       limit 1;
      if found then
        -- Someone added it since the list was read: use it, but never against a different unit.
        if v_existing.base <> v_base then
          raise exception 'this draft needs fixing before it can be confirmed' using errcode = 'invalid_parameter_value';
        end if;
        v_ing := v_existing.id;
      else
        insert into public.ingredients (org_id, name, name_bn, base)
        values (l.org_id, v_name, case when v_name ~ '[ঀ-৿]' then v_name end, v_base)
        returning id into v_ing;
        perform private.write_audit(l.org_id, l.branch_id, 'ingredient.create_from_chat', 'ingredient', v_ing::text,
          null, jsonb_build_object('name', v_name, 'base', v_base), 'new item on a bazar list, confirmed in the chat',
          null, null);
      end if;
    end if;
    v_lines := v_lines || jsonb_build_object('ingredient_id', v_ing,
                                             'qty_base', (x ->> 'qty_base')::numeric,
                                             'line_total_poisha', (x ->> 'line_total_poisha')::bigint);
  end loop;
  return public.confirm_purchase_draft(p_draft, null, nullif(btrim(d.extracted ->> 'supplier'), ''),
    private.business_date(d.created_at, private.branch_cutoff(d.org_id, d.branch_id)), v_lines);
end $$;

revoke execute on function public.chat_confirm_purchase_draft(public.chat_channel, text, uuid) from public, anon, authenticated;
grant execute on function public.chat_confirm_purchase_draft(public.chat_channel, text, uuid) to service_role;
comment on function public.chat_confirm_purchase_draft is 'Bot (service role): ✅ confirms the chat''s own complete draft as the linked person, creating any new ingredients on it first (audited). Phase 11.';
