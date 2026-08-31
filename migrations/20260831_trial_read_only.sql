-- Certo Agro: trial de 7 dias e modo somente leitura após vencimento.
-- Aplicar no projeto Supabase arroba-certa depois de revisar em homologação.

create or replace function public.assinatura_em_modo_leitura(p_fazenda_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.assinatura a
    where a.fazenda_id = p_fazenda_id
      and (
        lower(a.status::text) in ('vencida', 'cancelada')
        or (
          lower(a.status::text) = 'trial'
          and a.data_inicio_trial is not null
          and now() >= a.data_inicio_trial + interval '7 days'
        )
      )
  );
$$;

create or replace function public.iniciar_trial_fazenda()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.assinatura (fazenda_id, status, data_inicio_trial)
  values (new.id, 'trial', now())
  on conflict (fazenda_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_fazenda_inicia_trial on public.fazenda;
create trigger trg_fazenda_inicia_trial
after insert on public.fazenda
for each row execute function public.iniciar_trial_fazenda();

create or replace function public.bloqueia_escrita_trial_expirado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fazenda_id uuid;
begin
  if tg_op = 'DELETE' then
    if tg_table_name = 'fazenda' then
      v_fazenda_id := old.id;
    elsif tg_table_name = 'lote' or tg_table_name = 'config' then
      v_fazenda_id := old.fazenda_id;
    else
      select l.fazenda_id into v_fazenda_id
      from public.lote l
      where l.id = old.lote_id;
    end if;
  else
    if tg_table_name = 'fazenda' then
      v_fazenda_id := new.id;
    elsif tg_table_name = 'lote' or tg_table_name = 'config' then
      v_fazenda_id := new.fazenda_id;
    else
      select l.fazenda_id into v_fazenda_id
      from public.lote l
      where l.id = new.lote_id;
    end if;
  end if;

  if v_fazenda_id is not null and public.assinatura_em_modo_leitura(v_fazenda_id) then
    raise exception 'TRIAL_EXPIRADO: escolha um plano para continuar editando seus dados';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_bloqueia_trial_fazenda on public.fazenda;
create trigger trg_bloqueia_trial_fazenda
before insert or update or delete on public.fazenda
for each row execute function public.bloqueia_escrita_trial_expirado();

drop trigger if exists trg_bloqueia_trial_lote on public.lote;
create trigger trg_bloqueia_trial_lote
before insert or update or delete on public.lote
for each row execute function public.bloqueia_escrita_trial_expirado();

drop trigger if exists trg_bloqueia_trial_pesagem on public.pesagem;
create trigger trg_bloqueia_trial_pesagem
before insert or update or delete on public.pesagem
for each row execute function public.bloqueia_escrita_trial_expirado();

drop trigger if exists trg_bloqueia_trial_custo on public.custo;
create trigger trg_bloqueia_trial_custo
before insert or update or delete on public.custo
for each row execute function public.bloqueia_escrita_trial_expirado();

drop trigger if exists trg_bloqueia_trial_sanitario on public.sanitario;
create trigger trg_bloqueia_trial_sanitario
before insert or update or delete on public.sanitario
for each row execute function public.bloqueia_escrita_trial_expirado();

drop trigger if exists trg_bloqueia_trial_nutricao on public.nutricao;
create trigger trg_bloqueia_trial_nutricao
before insert or update or delete on public.nutricao
for each row execute function public.bloqueia_escrita_trial_expirado();

drop trigger if exists trg_bloqueia_trial_config on public.config;
create trigger trg_bloqueia_trial_config
before insert or update or delete on public.config
for each row execute function public.bloqueia_escrita_trial_expirado();
