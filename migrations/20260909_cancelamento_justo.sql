-- ============================================================================
-- 20260909 — Cancelamento justo: quem cancela usa até o fim do que já pagou
-- ============================================================================
-- PROBLEMA: 'cancelada' virava somente-leitura NA HORA. Quem cancelasse no dia 3
-- de um mês já pago perdia na hora o acesso que pagou. Além de injusto, isso
-- ensina o cliente a ter medo de cancelar (e a segurar o cancelamento até o
-- último dia) — exatamente o comportamento de assinatura predatória que a gente
-- não quer no Certo Agro.
--
-- SOLUÇÃO: coluna `acesso_ate`. Ao cancelar, grava o fim do período já pago.
-- Até essa data o cliente segue usando normal; depois vira somente-leitura,
-- com os dados sempre preservados.
--
-- Toda a trava de escrita do sistema (7 triggers) passa por
-- assinatura_em_modo_leitura(), então corrigir essa função sozinha já ajusta
-- lote, pesagem, custo, sanitário, nutrição, config e fazenda de uma vez.
-- ============================================================================

-- 1) Onde termina o acesso já pago (null = não se aplica / termina imediatamente)
alter table public.assinatura
  add column if not exists acesso_ate date;

comment on column public.assinatura.acesso_ate is
  'Fim do período já pago. Preenchido no cancelamento: o cliente segue usando '
  'normalmente até esta data. Depois, somente-leitura (dados preservados).';

-- 2) Modo leitura passa a respeitar o período já pago
create or replace function public.assinatura_em_modo_leitura(p_fazenda_id uuid)
returns boolean
language sql
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
    from public.assinatura a
    where a.fazenda_id = p_fazenda_id
      and (
        -- Vencida (pagamento falhou): bloqueia na hora, não há período pago.
        lower(a.status::text) = 'vencida'

        -- Cancelada: só bloqueia depois de acabar o que já foi pago.
        or (
          lower(a.status::text) = 'cancelada'
          and (a.acesso_ate is null or current_date > a.acesso_ate)
        )

        -- Trial de 7 dias vencido.
        or (
          lower(a.status::text) = 'trial'
          and a.data_inicio_trial is not null
          and now() >= a.data_inicio_trial + interval '7 days'
        )
      )
  );
$function$;

-- 3) O limite de plano também respeita o período já pago.
--    Cancelado-mas-dentro-do-prazo continua sujeito ao teto do plano dele
--    (não é upgrade grátis), mas não é tratado como inadimplente.
create or replace function public.lote_verifica_limite_plano()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_status text;
  v_plano_faixa_id int;
  v_acesso_ate date;
  v_cabecas_max int;
  v_plano_nome text;
  v_ativas_outros int;
  v_novo_total int;
  v_tolerancia int;
  v_proxima_nome text;
begin
  if NEW.data_saida is not null then
    return NEW;
  end if;

  select status, plano_faixa_id, acesso_ate
    into v_status, v_plano_faixa_id, v_acesso_ate
  from public.assinatura
  where fazenda_id = NEW.fazenda_id;

  if v_status is null or v_status in ('trial', 'cortesia') then
    return NEW;
  end if;

  -- Cancelou mas ainda está dentro do período pago: segue operando.
  if v_status = 'cancelada'
     and v_acesso_ate is not null
     and current_date <= v_acesso_ate then
    null; -- cai pra checagem normal de teto abaixo
  elsif v_status in ('vencida', 'cancelada') then
    raise exception 'Sua assinatura está %. Não é possível criar ou aumentar lotes agora — seus dados continuam disponíveis pra consulta. Regularize o pagamento pra voltar a operar.',
      v_status
      using errcode = 'P1002';
  end if;

  if v_plano_faixa_id is null then
    return NEW;
  end if;

  select cabecas_max into v_cabecas_max
  from public.plano_faixa
  where id = v_plano_faixa_id;

  if v_cabecas_max is null then
    return NEW;
  end if;

  select coalesce(sum(qtd_animais), 0) into v_ativas_outros
  from public.lote
  where fazenda_id = NEW.fazenda_id
    and data_saida is null
    and id is distinct from NEW.id;

  v_novo_total := v_ativas_outros + coalesce(NEW.qtd_animais, 0);
  v_tolerancia := floor(v_cabecas_max * 1.2)::int;

  if v_novo_total > v_tolerancia then
    select nome into v_plano_nome from public.plano_faixa where id = v_plano_faixa_id;
    select nome into v_proxima_nome from public.faixa_do_pico(v_novo_total);

    raise exception 'Seu plano % cobre até % cabeças (com 20%% de tolerância, até %). Esta operação levaria sua fazenda a % cabeças ativas. Faça upgrade pro plano % pra continuar.',
      v_plano_nome, v_cabecas_max, v_tolerancia, v_novo_total, coalesce(v_proxima_nome, 'superior')
      using errcode = 'P1001';
  end if;

  return NEW;
end;
$function$;

-- 4) limite_uso_fazenda também precisa saber que cancelado-no-prazo ainda opera,
--    senão o front mostraria "bloqueado" pra quem ainda tem acesso pago.
create or replace function public.limite_uso_fazenda(p_fazenda_id uuid)
returns jsonb
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_status text;
  v_plano_faixa_id int;
  v_acesso_ate date;
  v_ativas int;
  v_cabecas_max int;
  v_nome text;
  v_tolerancia int;
  v_percentual numeric;
  v_bloqueado boolean;
  v_proxima_nome text;
  v_proxima_preco numeric;
  v_no_prazo boolean;
begin
  select status, plano_faixa_id, acesso_ate
    into v_status, v_plano_faixa_id, v_acesso_ate
  from public.assinatura
  where fazenda_id = p_fazenda_id;

  v_ativas := public.cabecas_ativas_fazenda(p_fazenda_id);

  if v_status is null then
    return jsonb_build_object('status', 'sem_assinatura', 'cabecas_ativas', v_ativas);
  end if;

  if v_status in ('trial', 'cortesia') then
    return jsonb_build_object(
      'status', v_status, 'cabecas_ativas', v_ativas,
      'cabecas_max', null, 'bloqueado', false
    );
  end if;

  v_no_prazo := (v_status = 'cancelada'
                 and v_acesso_ate is not null
                 and current_date <= v_acesso_ate);

  if v_status in ('vencida', 'cancelada') and not v_no_prazo then
    return jsonb_build_object(
      'status', v_status, 'cabecas_ativas', v_ativas,
      'bloqueado', true, 'motivo', 'assinatura_' || v_status
    );
  end if;

  if v_plano_faixa_id is null then
    return jsonb_build_object(
      'status', v_status, 'cabecas_ativas', v_ativas, 'acesso_ate', v_acesso_ate,
      'cabecas_max', null, 'bloqueado', false, 'plano', 'empresarial_ou_sem_faixa'
    );
  end if;

  select nome, cabecas_max into v_nome, v_cabecas_max
  from public.plano_faixa where id = v_plano_faixa_id;

  if v_cabecas_max is null then
    return jsonb_build_object(
      'status', v_status, 'plano', v_nome, 'cabecas_ativas', v_ativas,
      'acesso_ate', v_acesso_ate, 'cabecas_max', null, 'bloqueado', false
    );
  end if;

  v_tolerancia := floor(v_cabecas_max * 1.2)::int;
  v_percentual := round((v_ativas::numeric / v_cabecas_max) * 100, 1);
  v_bloqueado := v_ativas > v_tolerancia;

  select nome, preco_mensal into v_proxima_nome, v_proxima_preco
  from public.faixa_do_pico(greatest(v_ativas, v_cabecas_max + 1));

  return jsonb_build_object(
    'status', v_status,
    'plano', v_nome,
    'acesso_ate', v_acesso_ate,
    'cabecas_ativas', v_ativas,
    'cabecas_max', v_cabecas_max,
    'tolerancia', v_tolerancia,
    'percentual_uso', v_percentual,
    'aviso', (v_ativas > v_cabecas_max and not v_bloqueado),
    'bloqueado', v_bloqueado,
    'proxima_faixa_nome', v_proxima_nome,
    'proxima_faixa_preco', v_proxima_preco
  );
end;
$function$;

-- 5) O dono cancela sozinho, sem pedir pra ninguém.
--    SECURITY DEFINER porque a RLS de `assinatura` só deixa service_role
--    escrever — mas a função confere que quem chama é o dono da fazenda.
--    NÃO cancela no gateway: isso é o n8n que faz (ver workflow de
--    cancelamento). Esta função é a fonte da verdade do NOSSO lado.
create or replace function public.cancelar_minha_assinatura(p_fazenda_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_dono uuid;
  v_status text;
  v_prox date;
  v_acesso_ate date;
begin
  select owner_id into v_dono from public.fazenda where id = p_fazenda_id;
  if v_dono is null then
    raise exception 'Fazenda não encontrada.' using errcode = 'P1003';
  end if;
  if v_dono <> auth.uid() and not public.eh_admin() then
    raise exception 'Você só pode cancelar a assinatura da sua própria fazenda.' using errcode = 'P1003';
  end if;

  select status, data_proxima_cobranca::date
    into v_status, v_prox
  from public.assinatura
  where fazenda_id = p_fazenda_id;

  if v_status is null then
    raise exception 'Não há assinatura para cancelar.' using errcode = 'P1003';
  end if;
  if v_status = 'cancelada' then
    select acesso_ate into v_acesso_ate from public.assinatura where fazenda_id = p_fazenda_id;
    return jsonb_build_object('ja_cancelada', true, 'acesso_ate', v_acesso_ate);
  end if;
  if v_status = 'cortesia' then
    raise exception 'Sua conta é cortesia e não tem cobrança para cancelar.' using errcode = 'P1003';
  end if;

  -- Trial não tem período pago a preservar; assinatura paga vai até a próxima cobrança.
  v_acesso_ate := case
    when v_status = 'trial' then null
    else greatest(coalesce(v_prox, current_date), current_date)
  end;

  update public.assinatura
     set status = 'cancelada',
         acesso_ate = v_acesso_ate,
         atualizado_em = now()
   where fazenda_id = p_fazenda_id;

  return jsonb_build_object('cancelada', true, 'acesso_ate', v_acesso_ate);
end;
$function$;

revoke all on function public.cancelar_minha_assinatura(uuid) from public;
grant execute on function public.cancelar_minha_assinatura(uuid) to authenticated;
