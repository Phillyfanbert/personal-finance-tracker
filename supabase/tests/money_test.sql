-- The money rules, tested in the real database against the real functions.
--
-- Run it in the Supabase SQL editor, through psql, or through the MCP
-- execute_sql tool. IT ALWAYS ENDS IN AN ERROR, ON PURPOSE: the error is what
-- rolls back everything the test wrote, so it cannot leave a row behind
-- however it is run, autocommit included. Read the error's text:
--
--   money tests: 61 passed, 0 failed
--
-- and anything after "failed:" names what broke. Every row it writes is a
-- test row (named "ZZ test ..."), written as the first signed-in user under
-- row-level security exactly as the app writes them, and none survives.
--
-- What it covers, and why each is here:
--   A  apply_money (86, 90): the two critical audit findings (a stale device
--      overwriting a balance, a half-finished save) plus the refusals that
--      replaced bugs found after shipping: a $484 overpayment, a bill logged
--      three times on one load, an undo reversing money twice, an edit that
--      left the wrong balance, a charge taken back off a paid-off card.
--   B  the row rules (89): no negative debt, no $0 expense, no balance below
--      its overdraft, and the rest.
--   C  refunds (89): never more than what is left of the purchase, and a
--      purchase with money back cannot be deleted on its own.
--   D  record_history (87): an edit keeps the old version; nobody can forge one.
--   E  reconcile_balances (89): normal actions add up, a change with no record
--      behind it is caught.
--   F  opening an account (91): the $0 asset or debt, the account and its
--      history row land together, or none of them does.
--   G  invitation and ownership (92): a sign-in account only for an invited
--      email, and no row pointing at another person's.

do $$
declare
  uid uuid := (select id from auth.users order by created_at limit 1);
  passed int := 0;
  failed text[] := '{}';
  err text;
  chk uuid; sav uuid; house uuid; card uuid; loan uuid;
  a_chk uuid; a_sav uuid; a_card uuid;
  e1 uuid; e2 uuid; p1 uuid; r1 uuid; act uuid; sub uuid; mc uuid;
  na uuid; nacc uuid; ncash uuid;
  other uuid; o_acct uuid; o_exp uuid; invited uuid := gen_random_uuid();
  r jsonb;
  v numeric;
  n int;
  rec record;
begin
  if uid is null then
    raise exception 'money tests: no signed-in user exists to run as';
  end if;
  -- G1, G2. Run before switching to the signed-in role, because they act as
  -- the sign-in service does. Only an invited email gets an account.
  begin
    insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
      values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-stranger@example.invalid', now(), now());
    failed := failed || 'G1 an uninvited email got an account'::text;
  exception when others then
    if sqlerrm = 'signup_not_invited' then passed := passed + 1; else failed := failed || format('G1 wrong error %s', sqlerrm); end if;
  end;
  insert into public.allowed_signups (email) values ('zz-invited@example.invalid');
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
    values (invited, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ZZ-Invited@Example.invalid', now(), now());
  select count(*) into n from public.profiles where id = invited;
  if n = 1 then passed := passed + 1; else failed := failed || 'G2 an invited email did not get an account and profile'::text; end if;
  -- Another person's account and purchase, for G3 and G4 below.
  other := invited;
  insert into public.accounts (user_id, name, type, bank_name) values (other, 'Theirs', 'debit', 'ZZ test') returning id into o_acct;
  insert into public.expenses (user_id, amount, category, payment_type, description) values (other, 50, 'Food', 'cash', 'ZZ test theirs') returning id into o_exp;

  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  insert into assets (name, type, value) values ('ZZ test checking', 'bank', 2500) returning id into chk;
  insert into assets (name, type, value) values ('ZZ test savings', 'savings', 1000) returning id into sav;
  insert into assets (name, type, value) values ('ZZ test house', 'property', 300000) returning id into house;
  insert into liabilities (name, type, balance, credit_limit) values ('ZZ test card', 'credit_card', 0, 1000) returning id into card;
  insert into liabilities (name, type, balance) values ('ZZ test loan', 'personal_loan', 5000) returning id into loan;
  insert into accounts (name, type, bank_name, linked_asset_id) values ('Checking', 'debit', 'ZZ test', chk) returning id into a_chk;
  insert into accounts (name, type, bank_name, linked_asset_id) values ('Savings', 'savings', 'ZZ test', sav) returning id into a_sav;
  insert into accounts (name, type, bank_name, linked_liability_id) values ('Credit', 'credit', 'ZZ test', card) returning id into a_card;

  -- ---- A. apply_money ---------------------------------------------------

  -- A1. Two devices, both showing $2,500, log $100 and $20. Each sends an
  -- amount, not a finished figure, so neither overwrites the other.
  perform apply_money(jsonb_build_array(
    jsonb_build_object('op', 'insert', 'table', 'expenses', 'row', jsonb_build_object('amount', 100, 'category', 'Food', 'payment_type', 'debit', 'account_id', a_chk, 'description', 'ZZ test A1 phone')),
    jsonb_build_object('op', 'asset', 'id', chk, 'delta', -100, 'floor', 0)));
  perform apply_money(jsonb_build_array(
    jsonb_build_object('op', 'insert', 'table', 'expenses', 'row', jsonb_build_object('amount', 20, 'category', 'Food', 'payment_type', 'debit', 'account_id', a_chk, 'description', 'ZZ test A1 laptop')),
    jsonb_build_object('op', 'asset', 'id', chk, 'delta', -20, 'floor', 0)));
  select value into v from assets where id = chk;
  if v = 2380 then passed := passed + 1; else failed := failed || format('A1 two devices left %s, want 2380', v); end if;

  -- A2. A save whose last step fails keeps NOTHING: not the expense, not the
  -- balance move before it.
  begin
    perform apply_money(jsonb_build_array(
      jsonb_build_object('op', 'insert', 'table', 'expenses', 'row', jsonb_build_object('amount', 14, 'category', 'Food', 'payment_type', 'debit', 'account_id', a_chk, 'description', 'ZZ test A2 half')),
      jsonb_build_object('op', 'asset', 'id', chk, 'delta', -14, 'floor', 0),
      jsonb_build_object('op', 'liability', 'id', gen_random_uuid(), 'delta', 1)));
    failed := failed || 'A2 a failing step was not refused'::text;
  exception when others then
    if sqlerrm = 'money_not_found' then passed := passed + 1; else failed := failed || format('A2 wrong error %s', sqlerrm); end if;
  end;
  select count(*) into n from expenses where description = 'ZZ test A2 half';
  select value into v from assets where id = chk;
  if n = 0 and v = 2380 then passed := passed + 1; else failed := failed || format('A2 half save left %s rows and %s', n, v); end if;

  -- A3. Spending past the floor is refused against the real balance.
  begin
    perform apply_money(jsonb_build_array(jsonb_build_object('op', 'asset', 'id', chk, 'delta', -5000, 'floor', 0)));
    failed := failed || 'A3 overspend was not refused'::text;
  exception when others then
    if sqlerrm = 'money_floor' then passed := passed + 1; else failed := failed || format('A3 wrong error %s', sqlerrm); end if;
  end;

  -- A4. A card charge past its limit is refused.
  begin
    perform apply_money(jsonb_build_array(jsonb_build_object('op', 'liability', 'id', card, 'delta', 1500, 'ceiling', 1000)));
    failed := failed || 'A4 over-limit charge was not refused'::text;
  exception when others then
    if sqlerrm = 'money_ceiling' then passed := passed + 1; else failed := failed || format('A4 wrong error %s', sqlerrm); end if;
  end;

  -- A5. Paying more than is owed is refused, never floored. Flooring it is
  -- how $484 once vanished: the debt stopped at $0 while the full payment
  -- still left the account.
  begin
    perform apply_money(jsonb_build_array(
      jsonb_build_object('op', 'asset', 'id', chk, 'delta', -500, 'floor', 0),
      jsonb_build_object('op', 'liability', 'id', card, 'delta', -500, 'strict', true)));
    failed := failed || 'A5 overpayment was not refused'::text;
  exception when others then
    if sqlerrm = 'money_below_zero' then passed := passed + 1; else failed := failed || format('A5 wrong error %s', sqlerrm); end if;
  end;
  select value into v from assets where id = chk;
  if v = 2380 then passed := passed + 1; else failed := failed || format('A5 refused payment still moved checking to %s', v); end if;

  -- A6. Two loads claiming the same bill cycle: the second finds the date
  -- already moved and logs nothing.
  insert into subscriptions (name, amount, billing_cycle, next_renewal, account_id)
    values ('ZZ test bill', 30, 'monthly', current_date, a_chk) returning id into sub;
  perform apply_money(jsonb_build_array(
    jsonb_build_object('op', 'update', 'table', 'subscriptions', 'id', sub,
      'set', jsonb_build_object('next_renewal', current_date + 30), 'expect', jsonb_build_object('next_renewal', current_date)),
    jsonb_build_object('op', 'insert', 'table', 'expenses', 'row', jsonb_build_object('amount', 30, 'category', 'Subscriptions', 'payment_type', 'debit', 'account_id', a_chk, 'description', 'ZZ test bill')),
    jsonb_build_object('op', 'asset', 'id', chk, 'delta', -30, 'floor', 0)));
  begin
    perform apply_money(jsonb_build_array(
      jsonb_build_object('op', 'update', 'table', 'subscriptions', 'id', sub,
        'set', jsonb_build_object('next_renewal', current_date + 30), 'expect', jsonb_build_object('next_renewal', current_date)),
      jsonb_build_object('op', 'insert', 'table', 'expenses', 'row', jsonb_build_object('amount', 30, 'category', 'Subscriptions', 'payment_type', 'debit', 'account_id', a_chk, 'description', 'ZZ test bill')),
      jsonb_build_object('op', 'asset', 'id', chk, 'delta', -30, 'floor', 0)));
    failed := failed || 'A6 a second claim on the same cycle was not refused'::text;
  exception when others then
    if sqlerrm = 'money_stale' then passed := passed + 1; else failed := failed || format('A6 wrong error %s', sqlerrm); end if;
  end;
  select count(*) into n from expenses where description = 'ZZ test bill';
  select value into v from assets where id = chk;
  if n = 1 and v = 2350 then passed := passed + 1; else failed := failed || format('A6 bill logged %s times, checking %s', n, v); end if;

  -- A7. Editing $14 to $20 reverses the old amount and applies the new one in
  -- one transaction, leaving exactly $6 less. (It once left $2,480 on $2,500.)
  r := apply_money(jsonb_build_array(
    jsonb_build_object('op', 'insert', 'table', 'expenses', 'row', jsonb_build_object('amount', 14, 'category', 'Food', 'payment_type', 'debit', 'account_id', a_chk, 'description', 'ZZ test A7')),
    jsonb_build_object('op', 'asset', 'id', chk, 'delta', -14, 'floor', 0)));
  e1 := (r -> 0 ->> 'id')::uuid;
  perform apply_money(jsonb_build_array(
    jsonb_build_object('op', 'update', 'table', 'expenses', 'id', e1, 'set', jsonb_build_object('amount', 20), 'expect', jsonb_build_object('amount', 14)),
    jsonb_build_object('op', 'asset', 'id', chk, 'delta', 14),
    jsonb_build_object('op', 'asset', 'id', chk, 'delta', -20, 'floor', 0)));
  select value into v from assets where id = chk;
  if v = 2330 then passed := passed + 1; else failed := failed || format('A7 edit left %s, want 2330', v); end if;
  -- An edit from a device that still thinks it is $14 is refused.
  begin
    perform apply_money(jsonb_build_array(
      jsonb_build_object('op', 'update', 'table', 'expenses', 'id', e1, 'set', jsonb_build_object('amount', 25), 'expect', jsonb_build_object('amount', 14)),
      jsonb_build_object('op', 'asset', 'id', chk, 'delta', 14)));
    failed := failed || 'A7 a stale edit was not refused'::text;
  exception when others then
    if sqlerrm = 'money_stale' then passed := passed + 1; else failed := failed || format('A7 wrong error %s', sqlerrm); end if;
  end;

  -- A8. Undoing the same history row twice reverses the money once.
  r := apply_money(jsonb_build_array(
    jsonb_build_object('op', 'asset', 'id', sav, 'delta', 200),
    jsonb_build_object('op', 'insert', 'table', 'account_activity', 'row', jsonb_build_object('kind', 'income', 'description', 'ZZ test pay', 'amount', 200, 'account_id', a_sav))));
  act := (r -> 1 ->> 'id')::uuid;
  perform apply_money(jsonb_build_array(
    jsonb_build_object('op', 'asset', 'id', sav, 'delta', -200, 'floor', 0),
    jsonb_build_object('op', 'delete', 'table', 'account_activity', 'id', act, 'expect', jsonb_build_object('amount', 200))));
  begin
    perform apply_money(jsonb_build_array(
      jsonb_build_object('op', 'asset', 'id', sav, 'delta', -200, 'floor', 0),
      jsonb_build_object('op', 'delete', 'table', 'account_activity', 'id', act, 'expect', jsonb_build_object('amount', 200))));
    failed := failed || 'A8 a second undo was not refused'::text;
  exception when others then
    if sqlerrm = 'money_stale' then passed := passed + 1; else failed := failed || format('A8 wrong error %s', sqlerrm); end if;
  end;
  select value into v from assets where id = sav;
  if v = 1000 then passed := passed + 1; else failed := failed || format('A8 savings %s after undo, want 1000', v); end if;

  -- A9. A correction's history row records the change the database made, not
  -- the one this device expected.
  r := apply_money(jsonb_build_array(
    jsonb_build_object('op', 'asset_set', 'id', house, 'value', 310000, 'ref', 'set'),
    jsonb_build_object('op', 'insert', 'table', 'account_activity', 'amount_from', 'set', 'skip_if_zero', true,
      'row', jsonb_build_object('kind', 'asset_adjust', 'description', 'ZZ test house value', 'asset_id', house))));
  select amount into v from account_activity where id = (r -> 1 ->> 'id')::uuid;
  if v = 10000 then passed := passed + 1; else failed := failed || format('A9 correction recorded %s, want 10000', v); end if;

  -- A10. A row can only ever belong to whoever wrote it.
  r := apply_money(jsonb_build_array(jsonb_build_object('op', 'insert', 'table', 'expenses',
    'row', jsonb_build_object('amount', 1, 'category', 'Food', 'payment_type', 'cash', 'user_id', gen_random_uuid(), 'description', 'ZZ test forged'))));
  select count(*) into n from expenses where id = (r -> 0 ->> 'id')::uuid and user_id = uid;
  if n = 1 then passed := passed + 1; else failed := failed || 'A10 a forged user_id was kept'::text; end if;

  -- A11. Charge $100, pay the card off, then take the charge back as a
  -- mistake. 86 floored what was owed at $0 and the $100 simply went; 90
  -- refuses it even from a step not marked strict, which is what an older copy
  -- of the app still sends.
  r := apply_money(jsonb_build_array(
    jsonb_build_object('op', 'insert', 'table', 'expenses', 'row', jsonb_build_object('amount', 100, 'category', 'Shopping', 'payment_type', 'credit', 'account_id', a_card, 'description', 'ZZ test mistaken charge')),
    jsonb_build_object('op', 'liability', 'id', card, 'delta', 100, 'ceiling', 1000)));
  mc := (r -> 0 ->> 'id')::uuid;
  perform apply_money(jsonb_build_array(
    jsonb_build_object('op', 'asset', 'id', sav, 'delta', -100, 'floor', 0),
    jsonb_build_object('op', 'liability', 'id', card, 'delta', -100, 'strict', true),
    jsonb_build_object('op', 'insert', 'table', 'account_activity', 'row', jsonb_build_object('kind', 'liability_payment', 'amount', 100,
      'account_id', a_sav, 'related_account_id', a_card, 'liability_id', card, 'description', 'ZZ test pay the card off'))));
  begin
    perform apply_money(jsonb_build_array(
      jsonb_build_object('op', 'delete', 'table', 'expenses', 'id', mc),
      jsonb_build_object('op', 'liability', 'id', card, 'delta', -100)));
    failed := failed || 'A11 taking back a charge on a paid-off card was floored, not refused'::text;
  exception when others then
    if sqlerrm = 'money_below_zero' then passed := passed + 1; else failed := failed || format('A11 wrong error %s', sqlerrm); end if;
  end;
  select balance into v from liabilities where id = card;
  select count(*) into n from expenses where id = mc;
  if v = 0 and n = 1 then passed := passed + 1; else failed := failed || format('A11 the refused take-back still left the card at %s with %s charge', v, n); end if;

  -- ---- B. Row rules -----------------------------------------------------

  -- B1. What is owed cannot go below zero, however it is written.
  begin
    update liabilities set balance = -5 where id = loan;
    failed := failed || 'B1 a negative debt was stored'::text;
  exception when check_violation then passed := passed + 1; end;

  -- B2. An expense is never $0.
  begin
    insert into expenses (amount, category, payment_type, description) values (0, 'Food', 'cash', 'ZZ test zero');
    failed := failed || 'B2 a $0 expense was stored'::text;
  exception when check_violation then passed := passed + 1; end;

  -- B3. Below zero only with an overdraft, only that far, only on a deposit account.
  begin
    update assets set value = -1 where id = chk;
    failed := failed || 'B3 checking went below zero with no overdraft'::text;
  exception when check_violation then passed := passed + 1; end;
  update assets set overdraft_limit = 100 where id = chk;
  update assets set value = -50 where id = chk;
  passed := passed + 1;
  begin
    update assets set value = -150 where id = chk;
    failed := failed || 'B3 checking went past its overdraft'::text;
  exception when check_violation then passed := passed + 1; end;
  begin
    update assets set overdraft_limit = 100, value = -1 where id = house;
    failed := failed || 'B3 a house was overdrawn'::text;
  exception when check_violation then passed := passed + 1; end;
  begin
    update assets set overdraft_limit = 40 where id = chk;
    failed := failed || 'B3 an overdraft was lowered below what is already overdrawn'::text;
  exception when check_violation then passed := passed + 1; end;
  update assets set value = 2330, overdraft_limit = null where id = chk;

  -- B4. A zero overdraft or a zero credit limit would store a number that does nothing.
  begin
    update assets set overdraft_limit = 0 where id = sav;
    failed := failed || 'B4 a zero overdraft was stored'::text;
  exception when check_violation then passed := passed + 1; end;
  begin
    update liabilities set credit_limit = 0 where id = card;
    failed := failed || 'B4 a zero credit limit was stored'::text;
  exception when check_violation then passed := passed + 1; end;

  -- B5. History rows carry the sign their kind implies.
  begin
    insert into account_activity (kind, description, amount, account_id) values ('liability_payment', 'ZZ test', -5, a_chk);
    failed := failed || 'B5 a negative payment was stored'::text;
  exception when check_violation then passed := passed + 1; end;
  begin
    insert into account_activity (kind, description, amount, account_id) values ('asset_adjust', 'ZZ test', 0, a_chk);
    failed := failed || 'B5 a $0 correction was stored'::text;
  exception when check_violation then passed := passed + 1; end;
  insert into account_activity (kind, description, amount, account_id) values ('account_created', 'ZZ test opened', 0, a_chk);
  passed := passed + 1;
  begin
    insert into account_activity (kind, description, amount, account_id, related_account_id) values ('transfer', 'ZZ test', 5, a_chk, a_chk);
    failed := failed || 'B5 a transfer to the same account was stored'::text;
  exception when check_violation then passed := passed + 1; end;

  -- B6. A bill, a pay source and a budget each need a real amount.
  begin
    insert into subscriptions (name, amount) values ('ZZ test free', 0);
    failed := failed || 'B6 a $0 bill was stored'::text;
  exception when check_violation then passed := passed + 1; end;
  begin
    insert into income (source, amount) values ('ZZ test nothing', 0);
    failed := failed || 'B6 $0 income was stored'::text;
  exception when check_violation then passed := passed + 1; end;
  begin
    insert into budgets (category, monthly_limit) values ('ZZ test', 0);
    failed := failed || 'B6 a $0 budget was stored'::text;
  exception when check_violation then passed := passed + 1; end;

  -- ---- C. Refunds -------------------------------------------------------

  r := apply_money(jsonb_build_array(
    jsonb_build_object('op', 'insert', 'table', 'expenses', 'row', jsonb_build_object('amount', 42, 'category', 'Shopping', 'payment_type', 'credit', 'account_id', a_card, 'description', 'ZZ test coat')),
    jsonb_build_object('op', 'liability', 'id', card, 'delta', 42, 'ceiling', 1000)));
  p1 := (r -> 0 ->> 'id')::uuid;
  r := apply_money(jsonb_build_array(
    jsonb_build_object('op', 'insert', 'table', 'expenses', 'row', jsonb_build_object('amount', -30, 'category', 'Shopping', 'payment_type', 'credit', 'account_id', a_card, 'description', 'ZZ test coat back', 'refund_of', p1)),
    jsonb_build_object('op', 'liability', 'id', card, 'delta', -30, 'strict', true)));
  r1 := (r -> 0 ->> 'id')::uuid;
  passed := passed + 1;

  -- C1. $30 has come back on $42, so $13 more is too much.
  begin
    insert into expenses (amount, category, payment_type, account_id, refund_of, description) values (-13, 'Shopping', 'credit', a_card, p1, 'ZZ test too much');
    failed := failed || 'C1 a refund larger than what was left was stored'::text;
  exception when others then
    if sqlerrm = 'money_refund_too_large' then passed := passed + 1; else failed := failed || format('C1 wrong error %s', sqlerrm); end if;
  end;
  perform apply_money(jsonb_build_array(
    jsonb_build_object('op', 'insert', 'table', 'expenses', 'row', jsonb_build_object('amount', -12, 'category', 'Shopping', 'payment_type', 'credit', 'account_id', a_card, 'description', 'ZZ test the rest', 'refund_of', p1)),
    jsonb_build_object('op', 'liability', 'id', card, 'delta', -12, 'strict', true)));
  passed := passed + 1;

  -- C2. Money back on money back is not a thing that happens.
  begin
    insert into expenses (amount, category, payment_type, account_id, refund_of, description) values (-1, 'Shopping', 'credit', a_card, r1, 'ZZ test refund of refund');
    failed := failed || 'C2 a refund of a refund was stored'::text;
  exception when others then
    if sqlerrm = 'money_refund_of_refund' then passed := passed + 1; else failed := failed || format('C2 wrong error %s', sqlerrm); end if;
  end;

  -- C3. A refund row is always negative, and a purchase cannot be edited
  -- below what has already come back on it.
  begin
    update expenses set amount = 30 where id = r1;
    failed := failed || 'C3 a refund was made positive'::text;
  exception when check_violation then passed := passed + 1; end;
  begin
    update expenses set amount = 20 where id = p1;
    failed := failed || 'C3 a purchase was edited below its refunds'::text;
  exception when others then
    if sqlerrm = 'money_refund_too_large' then passed := passed + 1; else failed := failed || format('C3 wrong error %s', sqlerrm); end if;
  end;

  -- C4. Deleting the purchase alone would put its whole amount back while its
  -- refund stays counted. Refused when the transaction ends; deleting the
  -- purchase and its refunds together is fine.
  begin
    delete from expenses where id = p1;
    set constraints expenses_refund_of_fkey immediate;
    failed := failed || 'C4 a refunded purchase was deleted on its own'::text;
  exception when foreign_key_violation then passed := passed + 1; end;
  set constraints expenses_refund_of_fkey deferred;
  begin
    delete from expenses where refund_of = p1 or id = p1;
    set constraints expenses_refund_of_fkey immediate;
    passed := passed + 1;
    raise exception 'C4 rollback';
  exception
    when foreign_key_violation then failed := failed || 'C4 deleting a purchase with its refunds was refused'::text;
    when others then if sqlerrm <> 'C4 rollback' then failed := failed || format('C4 wrong error %s', sqlerrm); end if;
  end;
  set constraints expenses_refund_of_fkey deferred;

  -- ---- D. record_history ------------------------------------------------

  select count(*) into n from record_history where row_id = e1 and action = 'update' and (old_row ->> 'amount')::numeric = 14;
  if n = 1 then passed := passed + 1; else failed := failed || format('D1 the edit kept %s earlier versions, want 1', n); end if;
  begin
    insert into record_history (user_id, table_name, action, old_row) values (uid, 'expenses', 'delete', '{}');
    failed := failed || 'D2 a history row was forged'::text;
  exception when insufficient_privilege then passed := passed + 1; end;

  -- ---- E. reconcile_balances --------------------------------------------

  -- E1. Everything above went through records, so every test balance adds up.
  -- That includes a transfer, a payment, an owed correction, an imported
  -- expense (which moves nothing) and a deleted expense.
  perform apply_money(jsonb_build_array(
    jsonb_build_object('op', 'asset', 'id', chk, 'delta', -300, 'floor', 0),
    jsonb_build_object('op', 'asset', 'id', sav, 'delta', 300),
    jsonb_build_object('op', 'insert', 'table', 'account_activity', 'row', jsonb_build_object('kind', 'transfer', 'description', 'ZZ test move', 'amount', 300, 'account_id', a_chk, 'related_account_id', a_sav))));
  perform apply_money(jsonb_build_array(
    jsonb_build_object('op', 'asset', 'id', chk, 'delta', -12, 'floor', 0),
    jsonb_build_object('op', 'liability', 'id', loan, 'delta', -12, 'strict', true),
    jsonb_build_object('op', 'insert', 'table', 'account_activity', 'row', jsonb_build_object('kind', 'liability_payment', 'description', 'ZZ test pay loan', 'amount', 12, 'account_id', a_chk, 'liability_id', loan))));
  perform apply_money(jsonb_build_array(
    jsonb_build_object('op', 'liability', 'id', loan, 'delta', 25),
    jsonb_build_object('op', 'insert', 'table', 'account_activity', 'row', jsonb_build_object('kind', 'owed_adjust', 'description', 'ZZ test interest', 'amount', 25, 'liability_id', loan))));
  insert into expenses (amount, category, payment_type, account_id, source, description) values (99, 'Food', 'debit', a_chk, 'import', 'ZZ test imported');
  perform apply_money(jsonb_build_array(
    jsonb_build_object('op', 'delete', 'table', 'expenses', 'id', e1, 'expect', jsonb_build_object('amount', 20)),
    jsonb_build_object('op', 'asset', 'id', chk, 'delta', 20)));
  select count(*) into n from reconcile_balances() where balance_id in (chk, sav, house, card, loan) and abs(difference) >= 0.005;
  if n = 0 then passed := passed + 1;
  else
    for rec in select * from reconcile_balances() where balance_id in (chk, sav, house, card, loan) and abs(difference) >= 0.005 loop
      failed := failed || format('E1 %s off by %s (opening %s, recorded %s, actual %s)', rec.balance_table, rec.difference, rec.opening, rec.recorded, rec.actual);
    end loop;
  end if;
  select count(*) into n from reconcile_balances() where balance_id in (chk, sav, house, card, loan);
  if n = 5 then passed := passed + 1; else failed := failed || format('E1 checked %s of the 5 test balances', n); end if;

  -- E2. A balance changed with no record behind it is caught, by exactly the
  -- amount, and only on that balance.
  update assets set value = value + 50 where id = sav;
  update liabilities set balance = balance + 7 where id = loan;
  select difference into v from reconcile_balances() where balance_id = sav;
  if v = 50 then passed := passed + 1; else failed := failed || format('E2 savings off by %s, want 50', v); end if;
  select difference into v from reconcile_balances() where balance_id = loan;
  if v = 7 then passed := passed + 1; else failed := failed || format('E2 loan off by %s, want 7', v); end if;
  select difference into v from reconcile_balances() where balance_id = chk;
  if v = 0 then passed := passed + 1; else failed := failed || format('E2 checking off by %s, want 0', v); end if;

  -- E3. A record changed without its balance following is caught too.
  update account_activity set amount = 400 where kind = 'transfer' and description = 'ZZ test move';
  select difference into v from reconcile_balances() where balance_id = chk;
  if v = 100 then passed := passed + 1; else failed := failed || format('E3 checking off by %s, want 100', v); end if;

  -- E4. Every kind that moves money has an effect; opening an account has none.
  select count(*) into n from money_effects('account_activity',
    jsonb_build_object('kind', 'account_created', 'amount', 0, 'account_id', a_chk));
  if n = 0 then passed := passed + 1; else failed := failed || 'E4 opening an account moved money'::text; end if;
  select count(*) into n from money_effects('account_activity',
    jsonb_build_object('kind', 'contribution', 'amount', 50, 'asset_id', house, 'source', 'holding_purchase'));
  if n = 0 then passed := passed + 1; else failed := failed || 'E4 a purchase-recorded contribution moved its account'::text; end if;
  select count(*) into n from money_effects('account_activity',
    jsonb_build_object('kind', 'income', 'amount', 50, 'account_id', a_chk, 'source', 'import'));
  if n = 0 then passed := passed + 1; else failed := failed || 'E4 imported income moved its account'::text; end if;
  select sum(delta) into v from money_effects('account_activity',
    jsonb_build_object('kind', 'holding_sale', 'amount', 75, 'account_id', a_chk));
  if v = 75 then passed := passed + 1; else failed := failed || format('E4 a sale moved %s, want 75', v); end if;

  -- ---- F. Opening an account -------------------------------------------

  -- F1. The $0 debt, the account pointing at it and its history row, in one
  -- call, all belonging to whoever wrote them.
  na := gen_random_uuid(); nacc := gen_random_uuid();
  perform apply_money(jsonb_build_array(
    jsonb_build_object('op', 'insert', 'table', 'liabilities', 'row', jsonb_build_object('id', na, 'name', 'ZZ test new card', 'type', 'credit_card', 'balance', 0)),
    jsonb_build_object('op', 'insert', 'table', 'accounts', 'row', jsonb_build_object('id', nacc, 'name', 'Credit', 'bank_name', 'ZZ test', 'type', 'credit', 'linked_liability_id', na)),
    jsonb_build_object('op', 'insert', 'table', 'account_activity', 'row', jsonb_build_object('kind', 'account_created', 'description', 'ZZ test opened a card', 'amount', 0, 'account_id', nacc))));
  select count(*) into n from accounts a join liabilities l on l.id = a.linked_liability_id
    where a.id = nacc and a.user_id = uid and l.user_id = uid;
  if n = 1 then passed := passed + 1; else failed := failed || 'F1 the new card and its account did not land together as the writer'::text; end if;
  select count(*) into n from account_activity where account_id = nacc and kind = 'account_created';
  if n = 1 then passed := passed + 1; else failed := failed || format('F1 opening the account wrote %s history rows, want 1', n); end if;

  -- F2. A second Cash account is refused by the one-per-person index, and the
  -- Cash asset made for it goes too, rather than staying behind as a stray $0.
  if not exists (select 1 from accounts where type = 'cash' and user_id = uid) then
    ncash := gen_random_uuid();
    perform apply_money(jsonb_build_array(
      jsonb_build_object('op', 'insert', 'table', 'assets', 'row', jsonb_build_object('id', ncash, 'name', 'ZZ test first cash', 'type', 'cash', 'value', 0)),
      jsonb_build_object('op', 'insert', 'table', 'accounts', 'row', jsonb_build_object('name', 'Cash', 'type', 'cash', 'linked_asset_id', ncash))));
  end if;
  ncash := gen_random_uuid();
  begin
    perform apply_money(jsonb_build_array(
      jsonb_build_object('op', 'insert', 'table', 'assets', 'row', jsonb_build_object('id', ncash, 'name', 'ZZ test second cash', 'type', 'cash', 'value', 0)),
      jsonb_build_object('op', 'insert', 'table', 'accounts', 'row', jsonb_build_object('name', 'Cash', 'type', 'cash', 'linked_asset_id', ncash))));
    failed := failed || 'F2 a second Cash account was opened'::text;
  exception when unique_violation then passed := passed + 1; end;
  select count(*) into n from assets where id = ncash;
  if n = 0 then passed := passed + 1; else failed := failed || 'F2 the refused Cash account left its asset behind'::text; end if;

  -- ---- G. Ownership -----------------------------------------------------

  -- G3. An expense on another person's account is refused.
  begin
    perform apply_money(jsonb_build_array(jsonb_build_object('op', 'insert', 'table', 'expenses', 'row',
      jsonb_build_object('amount', 5, 'category', 'Food', 'payment_type', 'debit', 'account_id', o_acct, 'description', 'ZZ test cross'))));
    failed := failed || 'G3 an expense on another person''s account was saved'::text;
  exception when others then
    if sqlerrm = 'money_not_yours' then passed := passed + 1; else failed := failed || format('G3 wrong error %s', sqlerrm); end if;
  end;
  -- G4. Money back on another person's purchase is refused, which is what
  -- stopped them deleting it.
  begin
    insert into expenses (amount, category, payment_type, refund_of, description) values (-5, 'Food', 'cash', o_exp, 'ZZ test cross refund');
    failed := failed || 'G4 a refund of another person''s purchase was saved'::text;
  exception when others then
    if sqlerrm = 'money_not_yours' then passed := passed + 1; else failed := failed || format('G4 wrong error %s', sqlerrm); end if;
  end;

  raise exception 'money tests: % passed, % failed%', passed, coalesce(array_length(failed, 1), 0),
    case when array_length(failed, 1) > 0 then ': ' || array_to_string(failed, ' | ') else '' end;
end $$;
