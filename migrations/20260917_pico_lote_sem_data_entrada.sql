-- 17/09/2026 — Lote sem data de entrada sumia da cobrança.
--
-- O PROBLEMA
-- calc_pico_cabecas monta o rebanho do período assim:
--
--     baseline: where data_entrada <= p_inicio        -- quem já estava lá
--     eventos:  where data_entrada >  p_inicio ...    -- quem entrou no meio
--
-- `data_entrada` é NULL-ável e o formulário de lote NÃO exige (só o nome é
-- obrigatório; a importação por planilha exige só nome e quantidade). E NULL
-- não satisfaz nenhuma das duas comparações — então um lote sem data de entrada
-- não entra no baseline NEM nos eventos: fica invisível pra cobrança.
--
-- Medido: fazenda com 500 cabeças (100 com data + 400 sem) → o pico devolvia
-- 100. Faixa justa Profissional (R$ 249,90), cobrada Iniciante (R$ 99,00).
-- R$ 150,90/mês de diferença por cliente, sem precisar de má-fé nenhuma — basta
-- deixar o campo vazio.
--
-- Agrava porque as duas contas discordam entre si: cabecas_ativas_fazenda (que
-- alimenta o limite do plano) conta esse lote normalmente. Ou seja, o mesmo
-- animal bloqueia lançamento por estourar o teto, mas não entra na fatura.
--
-- A CORREÇÃO
-- Sem data de entrada, assume-se que o lote JÁ ESTAVA na fazenda no início do
-- período — entra no baseline. É a leitura conservadora e a única coerente com
-- "pago pela capacidade que usei": o animal existe, está ativo, e o app não tem
-- motivo pra fingir que ele apareceu depois.
--
-- Não mexe em lote com data preenchida: o resultado é idêntico ao anterior.

create or replace function public.calc_pico_cabecas(p_fazenda_id uuid, p_inicio date, p_fim date)
 returns integer
 language sql
 stable
 set search_path to ''
as $function$
  with baseline as (
    select coalesce(sum(coalesce(qtd_animais,0)),0)::int as total
    from public.lote
    where fazenda_id = p_fazenda_id
      -- data_entrada nula = já estava aqui (ver cabeçalho da migration)
      and (data_entrada is null or data_entrada <= p_inicio)
      and (data_saida is null or data_saida > p_inicio)
  ),
  eventos as (
    select data_entrada as data, coalesce(qtd_animais,0) as delta
    from public.lote
    where fazenda_id = p_fazenda_id
      and data_entrada is not null
      and data_entrada > p_inicio and data_entrada <= p_fim
    union all
    select data_saida as data, -coalesce(qtd_animais,0) as delta
    from public.lote
    where fazenda_id = p_fazenda_id
      and data_saida is not null
      and data_saida > p_inicio and data_saida <= p_fim
  ),
  corrida as (
    select data, delta,
      (select total from baseline)
        + sum(delta) over (order by data, delta desc rows unbounded preceding) as total_acumulado
    from eventos
  )
  select greatest(
    (select total from baseline),
    coalesce((select max(total_acumulado) from corrida), 0)
  );
$function$;

comment on function public.calc_pico_cabecas(uuid, date, date) is
  'Pico de cabeças ativas no período — base da faixa de cobrança. Lote sem '
  'data_entrada conta como já presente no início do período, senão sumiria da '
  'fatura (o formulário não exige essa data).';
