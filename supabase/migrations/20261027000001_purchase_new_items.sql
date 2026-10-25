-- ADR 0039: type the bazar like a person says it; a new item is added by the same save.
--
-- The Purchases form no longer makes the purchaser pick from a list. A line can name an item that is
-- not in the list yet ({"new_ingredient": {"name": "kacha morich", "base": "g"}}); this function adds
-- it (or finds it by name, Bangla name or a learnt spelling, so a typo-twin is never made) and records
-- the purchase in the same transaction, so a refused purchase leaves no stray item behind.

create function public.record_purchase_with_new_items(
  p_org uuid, p_branch uuid, p_supplier uuid, p_supplier_name text, p_purchased_on date, p_lines jsonb,
  p_notes text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_lines jsonb := '[]'::jsonb;
  v_line jsonb;
  v_ing uuid;
  v_name text;
  v_base public.base_unit;
  v_existing public.ingredients;
begin
  if not private.can_access_branch_role(p_org, p_branch, array['owner', 'purchaser']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 100 then
    raise exception 'a purchase needs 1–100 lines' using errcode = 'invalid_parameter_value';
  end if;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_ing := nullif(v_line ->> 'ingredient_id', '')::uuid;
    if v_ing is null then
      if jsonb_typeof(v_line -> 'new_ingredient') <> 'object' then
        raise exception 'each line needs a known ingredient' using errcode = 'invalid_parameter_value';
      end if;
      v_name := left(btrim(v_line -> 'new_ingredient' ->> 'name'), 120);
      v_base := (v_line -> 'new_ingredient' ->> 'base')::public.base_unit;
      if coalesce(v_name, '') = '' or v_base is null then
        raise exception 'each line needs a known ingredient' using errcode = 'invalid_parameter_value';
      end if;
      select i.* into v_existing from public.ingredients i
       where i.org_id = p_org
         and (lower(i.name) = lower(v_name) or lower(coalesce(i.name_bn, '')) = lower(v_name)
              or exists (select 1 from public.ingredient_aliases a
                          where a.org_id = p_org and a.ingredient_id = i.id and lower(btrim(a.alias)) = lower(v_name)))
       order by i.is_active desc
       limit 1;
      if found then
        if v_existing.base <> v_base then
          raise exception 'ingredient "%" is kept in another unit', v_name using errcode = 'invalid_parameter_value';
        end if;
        v_ing := v_existing.id;
      else
        insert into public.ingredients (org_id, name, name_bn, base)
        values (p_org, v_name, case when v_name ~ '[ঀ-৿]' then v_name end, v_base)
        returning id into v_ing;
        perform private.write_audit(p_org, p_branch, 'ingredient.create_from_purchase', 'ingredient', v_ing::text,
          null, jsonb_build_object('name', v_name, 'base', v_base), 'new item typed on the Purchases form',
          null, null);
      end if;
    end if;
    v_lines := v_lines || (v_line - 'new_ingredient' || jsonb_build_object('ingredient_id', v_ing));
  end loop;
  return private.write_purchase(p_org, p_branch,
    coalesce(p_supplier, private.find_or_create_supplier(p_org, p_supplier_name)),
    p_purchased_on, v_lines, 'form', p_notes);
end $$;

revoke execute on function public.record_purchase_with_new_items(uuid, uuid, uuid, text, date, jsonb, text)
  from public, anon;
grant execute on function public.record_purchase_with_new_items(uuid, uuid, uuid, text, date, jsonb, text)
  to authenticated, service_role;

comment on function public.record_purchase_with_new_items is
  'Owner/purchaser records a bazar purchase; a line may name a new item, which is found or added in the same transaction; audited. ADR 0039.';
