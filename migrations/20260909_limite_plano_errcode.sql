-- ============================================================================
-- 20260909 — Código de erro próprio no limite de plano
-- ============================================================================
-- POR QUÊ: o trigger lote_verifica_limite_plano já bloqueava certo, mas lançava
-- o erro genérico P0001. O front não tinha como distinguir "estourou o plano"
-- de qualquer outro erro do banco a não ser comparando o texto em português —
-- frágil (qualquer ajuste de copy quebraria a tela).
--
-- O QUE MUDA: só o ERRCODE. A lógica de bloqueio é idêntica à que já estava
-- em produção e testada. Agora:
--   P1001 = estourou o teto de cabeças do plano contratado
--   P1002 = assinatura vencida ou cancelada
-- O front usa esses códigos pra abrir a tela de upgrade em vez de erro cru.
-- ============================================================================

create or replace function public.lote_verifica_limite_plano()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_status text;
  v_plano_faixa_id int;
  v_cabecas_max int;
  v_plano_nome text;
  v_ativas_outros int;
  v_novo_total int;
  v_tolerancia int;
  v_proxima_nome text;
begin
  -- fechar lote (ou manter fechado) nunca bloqueia — reduz a contagem, não aumenta
  if NEW.data_saida is not null then
    return NEW;
  end if;

  select status, plano_faixa_id
    into v_status, v_plano_faixa_id
  from public.assinatura
  where fazenda_id = NEW.fazenda_id;

  -- sem assinatura cadastrada, trial (7 dias liberados pra tudo) ou cortesia: uso livre
  if v_status is null or v_status in ('trial', 'cortesia') then
    return NEW;
  end if;

  if v_status in ('vencida', 'cancelada') then
    raise exception 'Sua assinatura está %. Não é possível criar ou aumentar lotes agora — seus dados continuam disponíveis pra consulta. Regularize o pagamento pra voltar a operar.',
      v_status
      using errcode = 'P1002';
  end if;

  -- ativa, sem faixa definida (ex.: Empresarial, venda manual): sem limite automático
  if v_plano_faixa_id is null then
    return NEW;
  end if;

  select cabecas_max into v_cabecas_max
  from public.plano_faixa
  where id = v_plano_faixa_id;

  -- faixa sem teto (ex.: Premium): sem limite
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
