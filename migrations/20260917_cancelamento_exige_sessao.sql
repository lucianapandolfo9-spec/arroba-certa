-- 17/09/2026 — Fecha bypass de autenticação no cancelamento de assinatura.
--
-- O QUE ESTAVA ERRADO
-- A trava era:
--     if v_dono <> auth.uid() and not public.eh_admin() then raise ...
-- Sem sessão, auth.uid() é NULL. Em SQL, `uuid <> NULL` não é falso: é NULL.
-- E `NULL and <qualquer coisa>` também é NULL — então o IF simplesmente não
-- dispara e a função seguia em frente. Resultado: com a chave anon (que é
-- pública por design, fica no código da página) e um fazenda_id, dava pra
-- cancelar a assinatura de QUALQUER fazenda sem estar logado.
-- Usuário logado nunca passou por esse furo: ali auth.uid() tem valor e a
-- comparação vira booleano de verdade.
--
-- A CORREÇÃO (três camadas, de propósito)
--  1. Exigir sessão explicitamente, antes de qualquer coisa.
--  2. Trocar `<>` por `is distinct from`, que trata NULL como valor e nunca
--     devolve NULL. Assim a trava continua valendo mesmo se a camada 1 mudar.
--  3. Tirar a permissão de execução do papel anon — quem não está logado não
--     tem por que nem alcançar essa função.
--
-- Nada muda para o dono da fazenda nem para admin.

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
  v_uid uuid;
begin
  v_uid := auth.uid();

  -- Camada 1: sem sessão, nem começa.
  if v_uid is null then
    raise exception 'Você precisa estar logado para cancelar a assinatura.'
      using errcode = 'P1003';
  end if;

  select owner_id into v_dono from public.fazenda where id = p_fazenda_id;
  if v_dono is null then
    raise exception 'Fazenda não encontrada.' using errcode = 'P1003';
  end if;

  -- Camada 2: `is distinct from` nunca devolve NULL.
  if v_dono is distinct from v_uid and not public.eh_admin() then
    raise exception 'Você só pode cancelar a assinatura da sua própria fazenda.'
      using errcode = 'P1003';
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

-- Camada 3: o CREATE OR REPLACE acima não mexe em grants, e toda função nasce
-- com EXECUTE para PUBLIC — é daí que o anon herdou o acesso.
revoke execute on function public.cancelar_minha_assinatura(uuid) from public;
revoke execute on function public.cancelar_minha_assinatura(uuid) from anon;
grant  execute on function public.cancelar_minha_assinatura(uuid) to authenticated;
