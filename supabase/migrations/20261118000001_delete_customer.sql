-- Delete a customer's number (ADR 0053). Owner or manager only; audited with the phone masked.
-- Everything that belongs only to the customer goes with them (consents, notification subscriptions, member
-- card and points, campaign rows). Bills and feedback stay, but no longer point at anyone (their customer_id
-- becomes null), so sales and money reports do not change.
create function public.delete_customer(p_org uuid, p_customer uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_c public.customers;
  v_visits bigint;
  v_points bigint;
begin
  if not private.has_role(p_org, array['owner', 'manager']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select * into v_c from public.customers where org_id = p_org and id = p_customer for update;
  if not found then
    raise exception 'customer not found' using errcode = 'no_data_found';
  end if;
  select count(*) into v_visits from public.orders
   where org_id = p_org and customer_id = p_customer and order_status = 'completed';
  select coalesce(sum(l.points), 0) into v_points from public.loyalty_points l
   where l.org_id = p_org and l.customer_id = p_customer;
  delete from public.customers where org_id = p_org and id = p_customer;
  perform private.write_audit(p_org, null, 'customer.delete', 'customer', p_customer::text,
    jsonb_build_object('phone', private.mask_phone(v_c.phone), 'visits', v_visits, 'points', v_points),
    null, null);
end $$;

revoke execute on function public.delete_customer(uuid, uuid) from public, anon;
grant execute on function public.delete_customer(uuid, uuid) to authenticated, service_role;
comment on function public.delete_customer is 'Owner or manager deletes a customer''s number; bills stay without it; audited (ADR 0053).';
