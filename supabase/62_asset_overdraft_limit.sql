-- OVERDRAFT: letting a deposit account go genuinely negative ------------------
--
-- Until this column, no asset balance could go below $0 by any path
-- (assetDeltaError). That rule is right for most of what this app holds and
-- WRONG for the single most ordinary case in real life: **a checking account
-- goes negative all the time.** That is an overdraft - the bank pays the
-- item, charges a fee, and the balance sits below zero until it is covered.
-- Refusing it meant someone actually overdrawn could not record what their
-- own statement said, which is the same "a true balance must stay
-- recordable" argument that already won for over-limit credit cards
-- (41_liability_credit_limit.sql) and for interest charges.
--
-- Stored as a POSITIVE allowance, not a negative floor: 500 means the
-- balance may reach -500. Null means no overdraft at all, which stays the
-- default, so every existing account behaves exactly as it did before.
--
-- **Deliberately per-account opt-in, and only for types that really have
-- one.** Cash cannot be overdrawn - there is no minus forty dollars in a
-- pocket. A CD, a brokerage, an HSA, a prepaid or payroll card cannot
-- either. `OVERDRAFT_ELIGIBLE_ASSET_TYPES` (app.js) is the gate, decided
-- per type rather than per category, the same rule BANK_VALIDATED_TYPES and
-- NON_SPENDABLE_ACCOUNT_TYPES already follow.
--
-- **This is NOT the `overdraft_line` liability type.** That one is a real
-- line of credit attached to an account, with its own balance owed and its
-- own credit limit. This is the deposit account itself dipping below zero.
-- Two different products; do not merge them.
--
-- **No fee is ever applied automatically.** A real overdraft fee is a
-- per-item charge the bank decides, and this app has no server to run a
-- rule on - the same reasoning that keeps credit interest a confirmed,
-- user-initiated action rather than an automatic one.
alter table assets add column if not exists overdraft_limit numeric(12,2);

alter table assets drop constraint if exists assets_overdraft_limit_check;
alter table assets add constraint assets_overdraft_limit_check
  check (overdraft_limit is null or overdraft_limit >= 0);

comment on column assets.overdraft_limit is
  'How far below zero this deposit account may go, as a POSITIVE number (500 means the balance may reach -500). Null means no overdraft: the balance floors at 0, which is the default and the behaviour for every account that has not opted in. Only set for real deposit types - cash, CDs and investment accounts can never be overdrawn.';
