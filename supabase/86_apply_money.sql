-- ONE TRANSACTION PER MONEY ACTION.
--
-- Until this, every money action was several separate requests from the
-- browser: save the expense, then write the account's new balance, then write
-- the card's. Two things went wrong with that, both measured against the
-- stand-in database on 2026-11-18:
--
--   1. A balance was written as a FINISHED FIGURE worked out on the device,
--      from that device's own copy. With a phone and a laptop both open, the
--      second one to save wrote its stale figure over the first: two
--      purchases of $100 and $20 on a $2,500 account left $2,480, not $2,380.
--   2. If a later request failed, the earlier ones stayed. The expense was
--      saved, the balance never moved, and the screen said "Saved". None of
--      the 30 places that moved a balance checked whether the move worked.
--
-- apply_money() takes the whole action as a list of steps and runs it as one
-- transaction: every step happens, or none does. Balances move by an AMOUNT
-- against the row as it is in the database, locked for the duration, so a
-- stale device can no longer overwrite anything, and the limits that refuse a
-- spend (an account's floor, a card's limit) are judged against that real
-- balance rather than the device's copy.
--
-- SECURITY INVOKER on purpose: every statement runs as the caller, so the
-- row-level security that keeps each person to their own rows applies to
-- every step exactly as it does to a direct request. This adds no access
-- that a signed-in user did not already have; it only adds atomicity.
--
-- Steps (each an object with "op"):
--   asset          {id, delta, floor?}   add delta to assets.value; a negative
--                                        delta that would end below floor is
--                                        refused (money_floor)
--   asset_set      {id, value}           set assets.value outright
--   liability      {id, delta, ceiling?, strict?}
--                                        add delta to liabilities.balance; a
--                                        positive delta past ceiling is refused
--                                        (money_ceiling); a result below zero is
--                                        refused when strict (money_below_zero)
--                                        and otherwise floored at zero, which
--                                        is what the app has always done for a
--                                        reversal
--   liability_set  {id, value}           set liabilities.balance outright
--   insert         {table, row | rows, amount_from?, skip_if_zero?}
--   update         {table, id, set, expect?}
--   delete         {table, id | ids, expect?}
-- Any step may carry "ref"; a later insert's "amount_from" names it and takes
-- the signed change that step made as its amount, which is how a correction's
-- history row records what really changed rather than what this device
-- thought would change.
--
-- "expect" makes an update or delete conditional on the row still holding
-- those values. A row that no longer matches, or is not there, refuses the
-- whole action (money_stale): that is what stops an undo running twice, an
-- edit reversing an amount another device already changed, and two devices
-- both logging the same bill.
--
-- Returns one result per step: {before, after} for a balance step, {id} or
-- {ids} for an insert, {count} for an update or delete, null for a skipped
-- insert.

create or replace function public.apply_money(steps jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  step jsonb;
  op text;
  tbl text;
  out jsonb := '[]'::jsonb;
  refs jsonb := '{}'::jsonb;
  cur numeric;
  nxt numeric;
  change numeric;
  rec jsonb;
  recs jsonb;
  expect jsonb;
  cols text;
  sets text;
  conds text;
  rid uuid;
  ids jsonb;
  target text;
  n int;
  total int;
begin
  if steps is null or jsonb_typeof(steps) <> 'array' or jsonb_array_length(steps) = 0 then
    raise exception using errcode = '22023', message = 'money_bad_step', detail = 'steps must be a non-empty array';
  end if;

  for step in select value from jsonb_array_elements(steps) loop
    op := step->>'op';
    change := null;

    if op in ('asset', 'asset_set') then
      select value into cur from assets where id = (step->>'id')::uuid for update;
      if not found then
        raise exception using errcode = 'P0002', message = 'money_not_found', detail = jsonb_build_object('table', 'assets', 'id', step->>'id')::text;
      end if;
      if op = 'asset' then
        change := round((step->>'delta')::numeric, 2);
        nxt := cur + change;
        if change < 0 and jsonb_typeof(step->'floor') = 'number' and nxt < (step->>'floor')::numeric then
          raise exception using errcode = 'P0001', message = 'money_floor',
            detail = jsonb_build_object('id', step->>'id', 'value', cur, 'floor', (step->>'floor')::numeric)::text;
        end if;
      else
        nxt := round((step->>'value')::numeric, 2);
        change := nxt - cur;
      end if;
      if nxt is null then
        raise exception using errcode = '22023', message = 'money_bad_step', detail = 'asset step needs a number';
      end if;
      if change <> 0 then
        update assets set value = nxt where id = (step->>'id')::uuid;
      end if;
      out := out || jsonb_build_array(jsonb_build_object('before', cur, 'after', nxt));

    elsif op in ('liability', 'liability_set') then
      select balance into cur from liabilities where id = (step->>'id')::uuid for update;
      if not found then
        raise exception using errcode = 'P0002', message = 'money_not_found', detail = jsonb_build_object('table', 'liabilities', 'id', step->>'id')::text;
      end if;
      if op = 'liability' then
        change := round((step->>'delta')::numeric, 2);
        nxt := cur + change;
        if change > 0 and jsonb_typeof(step->'ceiling') = 'number' and nxt > (step->>'ceiling')::numeric then
          raise exception using errcode = 'P0001', message = 'money_ceiling',
            detail = jsonb_build_object('id', step->>'id', 'balance', cur, 'ceiling', (step->>'ceiling')::numeric)::text;
        end if;
        if nxt < 0 then
          if coalesce((step->>'strict')::boolean, false) then
            raise exception using errcode = 'P0001', message = 'money_below_zero',
              detail = jsonb_build_object('id', step->>'id', 'balance', cur)::text;
          end if;
          nxt := 0;
        end if;
      else
        nxt := round((step->>'value')::numeric, 2);
        if nxt < 0 then
          raise exception using errcode = 'P0001', message = 'money_below_zero',
            detail = jsonb_build_object('id', step->>'id', 'balance', cur)::text;
        end if;
      end if;
      if nxt is null then
        raise exception using errcode = '22023', message = 'money_bad_step', detail = 'liability step needs a number';
      end if;
      change := nxt - cur;
      if change <> 0 then
        update liabilities set balance = nxt where id = (step->>'id')::uuid;
      end if;
      out := out || jsonb_build_array(jsonb_build_object('before', cur, 'after', nxt));

    elsif op = 'insert' then
      tbl := step->>'table';
      if tbl is null or tbl not in ('expenses', 'account_activity', 'holding_sales', 'assets') then
        raise exception using errcode = '22023', message = 'money_bad_step', detail = 'insert into ' || coalesce(tbl, 'nothing');
      end if;
      recs := case when step ? 'rows' then step->'rows' else jsonb_build_array(step->'row') end;
      if step ? 'amount_from' then
        if not refs ? (step->>'amount_from') then
          raise exception using errcode = '22023', message = 'money_bad_step', detail = 'amount_from names no earlier step';
        end if;
        change := (refs->>(step->>'amount_from'))::numeric;
        if change = 0 and coalesce((step->>'skip_if_zero')::boolean, false) then
          out := out || jsonb_build_array('null'::jsonb);
          continue;
        end if;
      end if;
      ids := '[]'::jsonb;
      for rec in select value from jsonb_array_elements(recs) loop
        if step ? 'amount_from' then
          rec := rec || jsonb_build_object('amount', change);
        end if;
        -- user_id is never taken from the request: the column's own default,
        -- auth.uid(), fills it, so a row can only ever belong to its writer.
        select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into cols
        from pg_attribute a
        where a.attrelid = format('public.%I', tbl)::regclass and a.attnum > 0
          and not a.attisdropped and a.attgenerated = ''
          and rec ? a.attname and a.attname <> 'user_id';
        if cols is null then
          raise exception using errcode = '22023', message = 'money_bad_step', detail = 'nothing to insert';
        end if;
        execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) returning id',
                       tbl, cols, cols, tbl)
          into rid using rec;
        ids := ids || to_jsonb(rid);
      end loop;
      out := out || jsonb_build_array(case when step ? 'rows'
        then jsonb_build_object('ids', ids) else jsonb_build_object('id', ids->0) end);

    elsif op = 'update' then
      tbl := step->>'table';
      if tbl is null or tbl not in ('expenses', 'subscriptions', 'income', 'assets', 'liabilities') then
        raise exception using errcode = '22023', message = 'money_bad_step', detail = 'update of ' || coalesce(tbl, 'nothing');
      end if;
      rec := coalesce(step->'set', '{}'::jsonb);
      expect := coalesce(step->'expect', '{}'::jsonb);
      select string_agg(format('%I = r.%I', a.attname, a.attname), ', ') into sets
      from pg_attribute a
      where a.attrelid = format('public.%I', tbl)::regclass and a.attnum > 0
        and not a.attisdropped and a.attgenerated = ''
        and rec ? a.attname and a.attname not in ('id', 'user_id', 'created_at');
      if sets is null then
        raise exception using errcode = '22023', message = 'money_bad_step', detail = 'nothing to update';
      end if;
      select coalesce(string_agg(format(' and t.%I is not distinct from e.%I', a.attname, a.attname), ''), '') into conds
      from pg_attribute a
      where a.attrelid = format('public.%I', tbl)::regclass and a.attnum > 0
        and not a.attisdropped and expect ? a.attname;
      execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) r, '
                     'jsonb_populate_record(null::public.%I, $2) e where t.id = $3%s',
                     tbl, sets, tbl, tbl, conds)
        using rec, expect, (step->>'id')::uuid;
      get diagnostics n = row_count;
      if n <> 1 then
        raise exception using errcode = 'P0001', message = 'money_stale', detail = jsonb_build_object('table', tbl, 'id', step->>'id')::text;
      end if;
      out := out || jsonb_build_array(jsonb_build_object('count', n));

    elsif op = 'delete' then
      tbl := step->>'table';
      if tbl is null or tbl not in ('expenses', 'account_activity', 'holding_sales') then
        raise exception using errcode = '22023', message = 'money_bad_step', detail = 'delete from ' || coalesce(tbl, 'nothing');
      end if;
      expect := coalesce(step->'expect', '{}'::jsonb);
      select coalesce(string_agg(format(' and t.%I is not distinct from e.%I', a.attname, a.attname), ''), '') into conds
      from pg_attribute a
      where a.attrelid = format('public.%I', tbl)::regclass and a.attnum > 0
        and not a.attisdropped and expect ? a.attname;
      ids := case when step ? 'ids' then step->'ids' else jsonb_build_array(step->'id') end;
      total := 0;
      for target in select value from jsonb_array_elements_text(ids) loop
        execute format('delete from public.%I t using jsonb_populate_record(null::public.%I, $1) e where t.id = $2%s',
                       tbl, tbl, conds)
          using expect, target::uuid;
        get diagnostics n = row_count;
        if n <> 1 then
          raise exception using errcode = 'P0001', message = 'money_stale', detail = jsonb_build_object('table', tbl, 'id', target)::text;
        end if;
        total := total + n;
      end loop;
      out := out || jsonb_build_array(jsonb_build_object('count', total));

    else
      raise exception using errcode = '22023', message = 'money_bad_step', detail = 'unknown step ' || coalesce(op, 'none');
    end if;

    if step ? 'ref' then
      refs := refs || jsonb_build_object(step->>'ref', change);
    end if;
  end loop;

  return out;
end;
$$;

-- PUBLIC holds EXECUTE on every new function by default (the trap recorded
-- in 65-67), so the revoke has to name it; signed-out visitors get nothing.
revoke all on function public.apply_money(jsonb) from public;
grant execute on function public.apply_money(jsonb) to authenticated, service_role;
