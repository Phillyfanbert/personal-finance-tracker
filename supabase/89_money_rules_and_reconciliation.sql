-- THE DATABASE ENFORCES THE MONEY RULES, AND CAN SAY WHETHER THE BOOKS ADD UP.
--
-- Two medium-priority items from the reliability audit of 2026-11-18:
--
--   6. Almost no money rule lived in the database. Nothing stopped a negative
--      debt, a $0 expense or a balance below its overdraft; those rules were
--      only in app.js, so any bug there wrote straight through.
--   8. Nothing checked a balance against the records that are meant to explain
--      it. A balance is a stored figure, so a change with no record behind it
--      went unnoticed.
--
-- Every rule below was checked against the live data before it was written:
-- no row breaks any of them. Each one is a rule the app already applies on its
-- own forms, so nothing the app does on purpose is refused; what changes is
-- that a bug, a stale device or a direct request can no longer get past it.

-- ---- 1. Row rules --------------------------------------------------------

-- A balance floors at zero, except a deposit account with an overdraft, which
-- may go as far below zero as its allowance and no further. The type list is
-- OVERDRAFT_ELIGIBLE_ASSET_TYPES in app.js; a limit stored on any other type
-- is ignored there, so it is ignored here too. Zero is not an allowance: the
-- app refuses to save one, because it would store a number that does nothing.
alter table public.assets
  add constraint assets_value_floor check (
    value >= 0
    or (overdraft_limit is not null
        and value >= -overdraft_limit
        and type in ('bank', 'savings', 'money_market', 'cash_management',
                     'second_chance_checking', 'digital_wallet', 'multi_currency'))),
  drop constraint assets_overdraft_limit_check,
  add constraint assets_overdraft_limit_check check (overdraft_limit is null or overdraft_limit > 0),
  add constraint assets_quantity_check check (quantity is null or quantity >= 0),
  add constraint assets_purchase_price_check check (purchase_price is null or purchase_price >= 0);

-- What is owed is never below zero: this app has no credit-balance concept to
-- hold one, which is why overpaying is refused rather than floored. A limit of
-- zero is refused for the same reason as an overdraft of zero.
alter table public.liabilities
  add constraint liabilities_balance_check check (balance >= 0),
  drop constraint liabilities_credit_limit_check,
  add constraint liabilities_credit_limit_check check (credit_limit is null or credit_limit > 0),
  add constraint liabilities_interest_rate_check check (interest_rate is null or interest_rate >= 0),
  add constraint liabilities_minimum_payment_check check (minimum_payment is null or minimum_payment >= 0);

-- An expense is never $0, and a refund (money back on a purchase) is always
-- negative. A negative row with no purchase is still allowed, because rows
-- from before 72 cannot be traced back to one.
alter table public.expenses
  add constraint expenses_amount_check check (amount <> 0 and (refund_of is null or amount < 0));

-- A purchase with money back recorded against it cannot be deleted on its own.
-- It used to be ON DELETE SET NULL, and deleting the purchase put its whole
-- amount back on the account while the refund stayed counted: a $42 purchase
-- refunded in full and then deleted left the account $42 better off than if it
-- had never happened. Deferred to the end of the transaction, so deleting the
-- purchase and its refunds together (a bulk delete, or deleting a person) still
-- works, and the app refuses the single delete first in plain words.
alter table public.expenses
  drop constraint expenses_refund_of_fkey,
  add constraint expenses_refund_of_fkey foreign key (refund_of)
    references public.expenses(id) deferrable initially deferred;

-- History rows carry the sign their kind implies. A correction is signed and
-- never zero; opening an account moves nothing; everything else is money that
-- arrived or left, recorded as a positive amount.
alter table public.account_activity
  add constraint account_activity_amount_check check (
    case kind
      when 'account_created' then amount = 0
      when 'asset_adjust' then amount <> 0
      when 'owed_adjust' then amount <> 0
      else amount > 0
    end),
  -- Null-tolerant on purpose: deleting an account sets these to null, and two
  -- deleted sides must not make the second deletion fail.
  add constraint account_activity_transfer_sides_check check (
    kind <> 'transfer' or account_id is null or related_account_id is null
    or account_id <> related_account_id);

alter table public.subscriptions add constraint subscriptions_amount_check check (amount > 0);
alter table public.income add constraint income_amount_check check (amount > 0);
alter table public.budgets add constraint budgets_monthly_limit_check check (monthly_limit > 0);
alter table public.holding_sales add constraint holding_sales_cost_basis_check check (cost_basis_removed >= 0);

-- ---- 2. A refund cannot be larger than what is left of the purchase -------
--
-- The app checked this by reading the refunds already recorded and comparing,
-- which two devices refunding at the same moment could both pass. The purchase
-- row is locked here, so the second waits for the first and then sees it.
-- Editing a purchase down below what has already come back on it is refused
-- for the same reason. SECURITY INVOKER (the default): the lock and the read
-- run as the caller, under the same row-level security as everything else.
create or replace function public.expenses_refund_cap()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target uuid;
  paid numeric;
  back numeric;
begin
  if new.refund_of is not null then
    target := new.refund_of;
  elsif tg_op = 'UPDATE' and new.amount is distinct from old.amount then
    target := new.id;
  else
    return new;
  end if;

  if target = new.id then
    paid := new.amount;
  else
    select amount into paid from public.expenses where id = target for update;
    -- A purchase that is not there is the deferred foreign key's to report.
    if not found then
      return new;
    end if;
    if paid <= 0 then
      raise exception using errcode = '23514', message = 'money_refund_of_refund',
        detail = jsonb_build_object('purchase', target)::text;
    end if;
  end if;

  select coalesce(sum(-amount), 0) into back
  from public.expenses where refund_of = target and id <> new.id;
  if new.refund_of is not null then
    back := back - new.amount;
  end if;
  if back > paid + 0.005 then
    raise exception using errcode = '23514', message = 'money_refund_too_large',
      detail = jsonb_build_object('purchase', target, 'paid', paid, 'back', back)::text;
  end if;
  return new;
end;
$$;

revoke all on function public.expenses_refund_cap() from public, anon, authenticated;

create trigger expenses_refund_cap before insert or update of amount, refund_of on public.expenses
  for each row execute function public.expenses_refund_cap();

-- ---- 3. Do the balances match their records? -----------------------------
--
-- money_effects() is what one record does to the balances it touches: the
-- same rules undoActivity() and deleteExpenseWithUndo() reverse in app.js,
-- written once here so the check below has a single definition to use. A new
-- account_activity kind that moves money must be taught here as well;
-- tests/reconcile.test.mjs fails until it is.
create or replace function public.money_effects(tbl text, doc jsonb)
returns table (balance_table text, balance_id uuid, delta numeric)
language sql
stable
set search_path = public
as $$
  with d as (
    select (doc ->> 'amount')::numeric as amt,
           doc ->> 'kind' as kind,
           coalesce(doc ->> 'source', '') as src,
           (doc ->> 'account_id')::uuid as acc,
           (doc ->> 'related_account_id')::uuid as rel,
           (doc ->> 'liability_id')::uuid as lia,
           (doc ->> 'asset_id')::uuid as ast
    where doc is not null
  ),
  x as (
    select d.*, a.linked_asset_id as acc_asset, a.linked_liability_id as acc_debt,
           r.linked_asset_id as rel_asset, r.linked_liability_id as rel_debt
    from d
    left join public.accounts a on a.id = d.acc
    left join public.accounts r on r.id = d.rel
  )
  -- An expense moves the account it was paid from. An imported one moves
  -- nothing: it is history the real balance already included.
  select 'assets', acc_asset, -amt from x
   where tbl = 'expenses' and src <> 'import' and acc_asset is not null
  union all
  select 'liabilities', acc_debt, amt from x
   where tbl = 'expenses' and src <> 'import' and acc_debt is not null
  -- A correction: through its account when it has one, otherwise straight to
  -- the asset it names (a house).
  union all
  select 'assets', case when acc is not null then acc_asset else ast end, amt from x
   where tbl = 'account_activity' and kind = 'asset_adjust'
     and (case when acc is not null then acc_asset else ast end) is not null
  union all
  select 'liabilities', coalesce(lia, acc_debt), amt from x
   where tbl = 'account_activity' and kind = 'owed_adjust' and coalesce(lia, acc_debt) is not null
  -- A payment leaves an account and lowers a debt; a transfer leaves one
  -- account and arrives in another.
  union all
  select 'assets', acc_asset, -amt from x
   where tbl = 'account_activity' and kind in ('liability_payment', 'transfer') and acc_asset is not null
  union all
  select 'liabilities', coalesce(lia, rel_debt), -amt from x
   where tbl = 'account_activity' and kind = 'liability_payment' and coalesce(lia, rel_debt) is not null
  union all
  select 'assets', rel_asset, amt from x
   where tbl = 'account_activity' and kind = 'transfer' and rel_asset is not null
  -- Money arriving: pay, interest, a dividend, a sale's proceeds. Imported
  -- income moves nothing, for the same reason an imported expense does not.
  union all
  select 'assets', acc_asset, amt from x
   where tbl = 'account_activity' and kind in ('income', 'holding_sale') and src <> 'import' and acc_asset is not null
  -- A contribution typed in moves the investment it names. One recorded from a
  -- purchase does not: the money is in the holding.
  union all
  select 'assets', ast, amt from x
   where tbl = 'account_activity' and kind = 'contribution' and src <> 'holding_purchase' and ast is not null
$$;

-- For each balance: what it was when record_history could first see it, what
-- the records say has happened to it since, and what it is now. A difference
-- means a balance moved with no record that explains it, or a record changed
-- without its balance following.
--
-- It works from record_history (87), which keeps every earlier version of the
-- records and of the balances, so it can only look back to when that began:
-- 2026-11-19 02:17:48 UTC. A balance created later starts from its creation.
--
-- Left out, because their figure is not the sum of records by design: anything
-- priced from the market (a price symbol, or holdings under it, or holdings it
-- had since the start of the window), and a car whose value the app works out
-- from its price and age. Every debt is included.
--
-- One known, real cause of a difference: taking a charge back off a card
-- (deleting or lowering an expense) after the card was paid below that amount
-- floors what is owed at zero, because there is no credit balance to hold the
-- rest. That is the books genuinely not adding up, and it is reported as such.
--
-- SECURITY INVOKER: a signed-in person sees only their own balances; the
-- server's service role sees everyone's.
create or replace function public.reconcile_balances(since timestamptz default null)
returns table (balance_table text, balance_id uuid, owner uuid, checked_from timestamptz,
               opening numeric, recorded numeric, expected numeric, actual numeric, difference numeric)
language sql
stable
set search_path = public
as $$
  with p as (
    select greatest(coalesce(since, '-infinity'::timestamptz), timestamptz '2026-11-19 02:17:48+00') as t0
  ),
  bal as (
    select 'assets'::text as tbl, a.id, a.user_id, a.value as cur,
           greatest(p.t0, coalesce(a.created_at, p.t0)) as tb
    from public.assets a cross join p
    where a.price_symbol is null
      and a.parent_asset_id is null
      and not exists (select 1 from public.assets c where c.parent_asset_id = a.id)
      and not exists (select 1 from public.record_history h
                      where h.table_name = 'assets' and h.action = 'delete' and h.changed_at >= p.t0
                        and h.old_row ->> 'parent_asset_id' = a.id::text)
      and not (a.type = 'vehicle' and a.depreciation_rate is not null
               and a.purchase_price is not null and a.purchase_date is not null)
    union all
    select 'liabilities', l.id, l.user_id, l.balance, greatest(p.t0, coalesce(l.created_at, p.t0))
    from public.liabilities l cross join p
  ),
  -- The balance at its starting point: the old value on the first change
  -- recorded after it, or the current value if nothing changed since.
  opened as (
    select b.*, coalesce((
      select (h.old_row ->> case b.tbl when 'assets' then 'value' else 'balance' end)::numeric
      from public.record_history h
      where h.table_name = b.tbl and h.row_id = b.id and h.changed_at >= b.tb
      order by h.changed_at, h.id
      limit 1), b.cur) as opening
    from bal b
  ),
  hist as (
    select h.id as hid, h.table_name as tbl, h.row_id, h.changed_at, h.old_row
    from public.record_history h cross join p
    where h.table_name in ('expenses', 'account_activity') and h.changed_at >= p.t0
  ),
  live as (
    select 'expenses'::text as tbl, e.id, coalesce(e.created_at, '-infinity') as created_at, to_jsonb(e) as doc
    from public.expenses e
    union all
    select 'account_activity', a.id, coalesce(a.created_at, '-infinity'), to_jsonb(a)
    from public.account_activity a
  ),
  -- Every record that can have changed since the start: written since, or
  -- edited or deleted since. One untouched since before then has the same
  -- effect at both ends, so it cannot change anything and is skipped.
  recs as (
    select l.tbl, l.id, l.created_at, l.doc as now_doc
    from live l cross join p
    where l.created_at >= p.t0 or exists (select 1 from hist h where h.tbl = l.tbl and h.row_id = l.id)
    union all
    select distinct on (h.tbl, h.row_id) h.tbl, h.row_id,
           coalesce((h.old_row ->> 'created_at')::timestamptz, '-infinity'), null::jsonb
    from hist h
    where not exists (select 1 from live l where l.tbl = h.tbl and l.id = h.row_id)
  ),
  -- Which balances each record has ever touched, in any version of it.
  pairs as (
    select distinct r.tbl, r.id, r.created_at, r.now_doc, e.balance_table, e.balance_id
    from recs r
    cross join lateral (
      select m.balance_table, m.balance_id from public.money_effects(r.tbl, r.now_doc) m
      union all
      select m.balance_table, m.balance_id
      from hist h cross join lateral public.money_effects(h.tbl, h.old_row) m
      where h.tbl = r.tbl and h.row_id = r.id
    ) e
  ),
  -- Each record's effect on the balance now, against its effect at that
  -- balance's starting point: nothing if it was written after, otherwise the
  -- version it had then.
  pair_moves as (
    select o.tbl, o.id, coalesce(n.d, 0) - coalesce(t.d, 0) as change
    from opened o
    join pairs pr on pr.balance_table = o.tbl and pr.balance_id = o.id
    cross join lateral (
      select sum(m.delta) as d from public.money_effects(pr.tbl, pr.now_doc) m
      where m.balance_table = o.tbl and m.balance_id = o.id) n
    cross join lateral (
      select sum(m.delta) as d
      from public.money_effects(pr.tbl,
        case when pr.created_at >= o.tb then null
             else coalesce((select h.old_row from hist h
                            where h.tbl = pr.tbl and h.row_id = pr.id and h.changed_at >= o.tb
                            order by h.changed_at, h.hid limit 1), pr.now_doc) end) m
      where m.balance_table = o.tbl and m.balance_id = o.id) t
  ),
  moved as (
    select tbl, id, sum(change) as recorded from pair_moves group by tbl, id
  )
  select o.tbl, o.id, o.user_id, o.tb, o.opening,
         coalesce(m.recorded, 0),
         o.opening + coalesce(m.recorded, 0),
         o.cur,
         o.cur - (o.opening + coalesce(m.recorded, 0))
  from opened o
  left join moved m on m.tbl = o.tbl and m.id = o.id
$$;

revoke all on function public.money_effects(text, jsonb) from public, anon;
revoke all on function public.reconcile_balances(timestamptz) from public, anon;
grant execute on function public.money_effects(text, jsonb) to authenticated, service_role;
grant execute on function public.reconcile_balances(timestamptz) to authenticated, service_role;

-- The server's daily balance check reports here like every other server job.
alter table public.agent_run_status drop constraint agent_run_status_agent_check;
alter table public.agent_run_status add constraint agent_run_status_agent_check
  check (agent = any (array['deal-agent', 'price-agent', 'price-agent-fast', 'daily-recap', 'server-sync', 'backup', 'reconcile']));
