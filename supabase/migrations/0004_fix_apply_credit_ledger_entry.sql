-- 0001_init.sql's apply_credit_ledger_entry() declared v_inserted as boolean
-- but assigned GET DIAGNOSTICS ... ROW_COUNT (an integer) into it, then
-- compared it with `> 0` - "operator does not exist: boolean > integer".
-- Every credit-ledger write (purchases, refunds, the dev-bypass path) goes
-- through this function, so the bug blocked confirmation -> generation
-- entirely. Fix: hold row_count in its own integer variable.
create or replace function apply_credit_ledger_entry(
  p_user_id uuid,
  p_amount integer,
  p_type credit_ledger_type,
  p_reference_type text,
  p_reference_id uuid,
  p_idempotency_key text,
  p_metadata jsonb default '{}'::jsonb
) returns table (applied boolean, balance integer) as $$
declare
  v_row_count integer;
  v_inserted boolean;
  v_balance integer;
begin
  insert into credit_wallets (user_id, balance)
    values (p_user_id, 0)
    on conflict (user_id) do nothing;

  insert into credit_ledger (
    user_id, amount, type, reference_type, reference_id, idempotency_key, metadata
  ) values (
    p_user_id, p_amount, p_type, p_reference_type, p_reference_id, p_idempotency_key, p_metadata
  )
  on conflict (idempotency_key) do nothing;

  get diagnostics v_row_count = row_count;
  v_inserted := (v_row_count > 0);

  if v_inserted then
    update credit_wallets
      set balance = balance + p_amount, updated_at = now()
      where user_id = p_user_id
      returning balance into v_balance;
  else
    select balance into v_balance from credit_wallets where user_id = p_user_id;
  end if;

  return query select v_inserted, v_balance;
end;
$$ language plpgsql security definer;
