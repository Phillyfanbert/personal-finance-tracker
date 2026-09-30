-- How an activity row came to exist, where that changes how it is reversed.
--
-- undoActivity has to know whether a 'contribution' row also moved the asset's
-- own value. A contribution typed in by hand does (the handler writes
-- assets.value = value + amount), while one recorded from a holding purchase
-- does not - that money sits in the holding, and syncParentAssetValue()
-- recomputes the parent from its holdings regardless.
--
-- It was inferring this from whether the asset currently has any holdings,
-- which is a proxy for a past fact and gives the wrong answer once those
-- holdings are deleted: undo would then subtract from the parent's own value
-- money that had already left with the holding. Recording it at write time
-- removes the inference from every present and future reader.
--
-- Nullable, and null means "hand-entered", which is what every row written
-- before this is. Verified zero 'contribution' rows existed when this was
-- applied, so there is nothing to backfill.
alter table account_activity add column if not exists source text;

comment on column account_activity.source is
  'How the row was created, where that changes how it is reversed. Null means hand-entered and is the default. ''holding_purchase'' marks a contribution derived from buying inside a limit-bearing account: it never moved assets.value, so undoing it deletes the row alone.';
