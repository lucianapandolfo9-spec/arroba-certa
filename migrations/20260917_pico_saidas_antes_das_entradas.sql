-- 17/09/2026 — Troca de lote no mesmo dia criava pico fantasma e cobrava a mais.
--
-- O PROBLEMA
-- A soma corrida do pico ordenava os eventos por `data, delta desc` — ou seja,
-- no MESMO dia as entradas (delta positivo) eram somadas antes das saídas.
--
-- Um produtor que vende 300 cabeças e compra 300 no mesmo dia nunca teve mais de
-- 300 na fazenda. Mas a soma corrida via: 300 (baseline) + 300 (entrada) = 600
-- de pico, e só então descontava a saída. Resultado medido: cobrava Profissional
-- (R$ 249,90) em vez de Essencial (R$ 169,90) — R$ 80/mês a mais.
--
-- E atinge justamente quem gira rebanho, que é o cliente mais valioso. Com
-- política de não-estorno, vira reclamação no primeiro mês.
--
-- A CORREÇÃO (decisão da Luh, 17/09)
-- `delta asc`: no mesmo dia, as SAÍDAS são processadas antes das entradas. O
-- pico passa a refletir a capacidade que de fato foi ocupada.
--
-- ⚠️ Isto NÃO abre brecha de malandragem, que era a razão de ser da regra de
-- pico. Fechar lote na véspera da virada pra reabrir depois continua sendo
-- pego, porque o pico varre o CICLO INTEIRO, não o dia. Testado:
--   • troca de 300 por 300 no mesmo dia          → pico 300  (Essencial R$ 169,90)
--   • fecha 800 na véspera e reabre 800 depois   → pico 1100 (Premium R$ 399,90)
--
-- Mantém a correção da migration anterior (lote sem data_entrada entra no
-- baseline). Nenhuma fazenda existente muda de número — conferido antes e depois.

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
      -- data_entrada nula = já estava aqui (senão o lote sumia da fatura)
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
        -- delta ASC: no mesmo dia, saída antes de entrada. Ver cabeçalho.
        + sum(delta) over (order by data, delta asc rows unbounded preceding) as total_acumulado
    from eventos
  )
  select greatest(
    (select total from baseline),
    coalesce((select max(total_acumulado) from corrida), 0)
  );
$function$;

comment on function public.calc_pico_cabecas(uuid, date, date) is
  'Pico de cabecas ativas no periodo — base da faixa de cobranca. Duas regras que '
  'parecem detalhe e mexem no valor da fatura: (1) lote sem data_entrada conta como '
  'ja presente no inicio do periodo, senao sumiria da fatura (o formulario nao exige '
  'essa data); (2) no mesmo dia as SAIDAS sao processadas antes das entradas '
  '(delta asc), senao uma troca de lote no mesmo dia criava pico fantasma e cobrava '
  'uma faixa a mais. Anti-malandragem continua valendo: o pico olha o ciclo inteiro, '
  'entao fechar lote na vespera e reabrir depois nao escapa.';
