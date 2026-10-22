-- ADR 0013 amendment: anyone who works a till or the kitchen screen may pair that screen for a
-- branch they have access to, so a cashier who opens POS is not stopped at "ask the owner".
-- Pairing only registers a screen (audited); working it still needs a staff PIN, and access to the
-- branch is still checked by can_access_branch_role.
create or replace function public.register_device(
  p_org uuid, p_branch uuid, p_name text, p_kind public.device_kind default 'pos'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_code text := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  v_id uuid;
begin
  if not private.can_access_branch_role(p_org, p_branch,
       array['owner', 'manager', 'cashier', 'kitchen']::public.app_role[]) then
    raise exception 'not allowed to register devices for this branch' using errcode = 'insufficient_privilege';
  end if;
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'device name is required' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.devices (org_id, branch_id, name, kind, registered_by, pairing_code_hash, pairing_expires_at)
  values (p_org, p_branch, btrim(p_name), p_kind, (select auth.uid()),
          encode(sha256(convert_to(v_code, 'utf8')), 'hex'), now() + interval '15 minutes')
  returning id into v_id;
  perform private.write_audit(p_org, p_branch, 'device.register', 'device', v_id::text, null,
    jsonb_build_object('name', btrim(p_name), 'kind', p_kind), null);
  return jsonb_build_object('device_id', v_id, 'pairing_code', v_code);
end $$;
