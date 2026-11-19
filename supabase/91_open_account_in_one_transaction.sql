-- OPENING AN ACCOUNT IS ONE TRANSACTION.
--
-- Adding an account was three separate requests: insert the $0 asset (or the
-- $0 debt for a card or loan), insert the account pointing at it, then write
-- the "Account opened" history row. A failure after the first left a stray $0
-- item under Things you have or Things you owe with no account behind it, and
-- one after the second left an account with no history explaining where it
-- came from. The automatic Cash account on a first load had the same shape.
--
-- apply_money() (86, 90) already runs a list of steps as one transaction; it
-- just would not insert into accounts or liabilities. Now it does. The app
-- makes the new ids itself (crypto.randomUUID()) so the account can name its
-- asset or debt inside the same call, and the insert step already copies an
-- id it is given.
--
-- Nothing is reachable here that was not before: both tables already accept
-- a signed-in user's own inserts directly, row-level security applies to every
-- step exactly as to a direct request (security invoker), and user_id still
-- comes only from the column's own default.
--
-- The function is otherwise exactly 90's.

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
        -- Refused, never floored. "strict" is still accepted so an older
        -- copy of the app sends nothing this does not understand, but it no
        -- longer changes anything: every result below zero is refused.
        if nxt < 0 then
          raise exception using errcode = 'P0001', message = 'money_below_zero',
            detail = jsonb_build_object('id', step->>'id', 'balance', cur)::text;
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
      if tbl is null or tbl not in ('expenses', 'account_activity', 'holding_sales', 'assets', 'liabilities', 'accounts') then
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

revoke all on function public.apply_money(jsonb) from public;
grant execute on function public.apply_money(jsonb) to authenticated, service_role;
