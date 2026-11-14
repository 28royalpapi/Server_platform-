alter table public.server_calls
  add column if not exists carrier_fallback_method text
    check (carrier_fallback_method is null or carrier_fallback_method = 'selected_sim'),
  add column if not exists carrier_fallback_status text
    check (carrier_fallback_status is null or carrier_fallback_status = any(array['requested','handed_off','failed','unavailable']::text[])),
  add column if not exists carrier_fallback_sim_slot integer
    check (carrier_fallback_sim_slot is null or carrier_fallback_sim_slot >= 0),
  add column if not exists carrier_fallback_carrier text
    check (carrier_fallback_carrier is null or length(btrim(carrier_fallback_carrier)) between 1 and 80),
  add column if not exists carrier_fallback_requested_at timestamptz,
  add column if not exists carrier_fallback_handed_off_at timestamptz,
  add column if not exists carrier_fallback_failed_at timestamptz,
  add column if not exists carrier_fallback_error_code text
    check (carrier_fallback_error_code is null or carrier_fallback_error_code ~ '^[A-Z0-9_]{1,64}$');

comment on column public.server_calls.carrier_fallback_method is
  'Actual fallback transport selected by the caller; selected_sim means Android Telecom handed the destination to the caller-selected cellular line.';
comment on column public.server_calls.carrier_fallback_status is
  'requested: handoff attempted; handed_off: Android Telecom accepted placeCall; failed: handoff failed; unavailable: consent, destination or SIM requirements prevented the handoff. It does not assert that the recipient answered.';
comment on column public.server_calls.carrier_fallback_sim_slot is
  'Zero-based SIM slot selected by the caller for this specific carrier fallback.';
comment on column public.server_calls.carrier_fallback_carrier is
  'Carrier label for the caller-selected SIM used for this specific carrier fallback.';

create index if not exists server_calls_caller_fallback_history_idx
  on public.server_calls (caller_user_id, created_at desc)
  where carrier_fallback_status is not null;
