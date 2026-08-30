-- apply_credit_ledger_entry() returns table(applied boolean, balance integer),
-- which PL/pgSQL treats as implicit OUT variables named `applied` and
-- `balance` in scope for the whole function body. The bare `balance`
-- references in `set balance = balance + p_amount` and `returning balance`
-- were therefore ambiguous against credit_wallets.balance -
-- "column reference \"balance\" is ambiguous". Fix: alias the table and
-- qualify every read of the column.
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
    update credit_wallets cw
      set balance = cw.balance + p_amount, updated_at = now()
      where cw.user_id = p_user_id
      returning cw.balance into v_balance;
  else
    select cw.balance into v_balance from credit_wallets cw where cw.user_id = p_user_id;
  end if;

  return query select v_inserted, v_balance;
end;
$$ language plpgsql security definer;
