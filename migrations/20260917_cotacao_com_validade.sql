-- 17/09/2026 — A view passa a dizer DE QUANDO é o preço que usou.
--
-- O PROBLEMA
-- vw_lote_analise pega a última cotação da praça sem nenhum limite de idade:
--
--     select ca.valor_rs from cotacao_arroba ca
--     where ca.praca = f.praca_referencia
--     order by ca.data desc limit 1
--
-- Se a automação de cotação parar, a view continua devolvendo o último preço
-- conhecido — para sempre, e sem sinal nenhum. Todo o número que o produtor usa
-- pra decidir (lucro/cab, margem por @, receita) sai desse preço. Ou seja: o app
-- segue afirmando um lucro com preço velho, exatamente o que a regra do projeto
-- proíbe ("preço da @ é AO VIVO, nunca de cabeça").
--
-- Não é hipótese: a automação já ficou 3 dias quebrada (06→09/07/2026, senha do
-- banco desatualizada na credencial do n8n) e ninguém percebeu, porque a tela
-- continuou mostrando preço com cara de atual.
--
-- A DECISÃO
-- Não zerar o preço quando envelhece — isso apagaria o lucro da tela inteira num
-- soluço da fonte, o que é pior. Em vez disso, a view EXPÕE a data da cotação
-- usada, e o app mostra essa data junto do número e avisa quando está velha.
-- Mostrar "R$ 344/@ de 16/09" é honesto; mostrar "R$ 344/@" sozinho não é.
--
-- Só ACRESCENTA coluna no fim (exigência do create or replace view) — nenhuma
-- coluna existente muda de nome, tipo ou posição.

create or replace view public.vw_lote_analise
with (security_invoker = true)
as
 WITH pesos AS (
         SELECT l.id AS lote_id,
            COALESCE(l.peso_entrada_medio_kg, ( SELECT p.peso_medio_kg
                   FROM pesagem p
                  WHERE p.lote_id = l.id
                  ORDER BY p.data, p.criado_em
                 LIMIT 1)) AS peso_inicial_kg,
            COALESCE(l.data_entrada, ( SELECT p.data
                   FROM pesagem p
                  WHERE p.lote_id = l.id
                  ORDER BY p.data, p.criado_em
                 LIMIT 1)) AS data_inicial,
            COALESCE(( SELECT p.peso_medio_kg
                   FROM pesagem p
                  WHERE p.lote_id = l.id
                  ORDER BY p.data DESC, p.criado_em DESC
                 LIMIT 1), l.peso_entrada_medio_kg) AS peso_atual_kg,
            COALESCE(( SELECT p.data
                   FROM pesagem p
                  WHERE p.lote_id = l.id
                  ORDER BY p.data DESC, p.criado_em DESC
                 LIMIT 1), l.data_entrada) AS data_atual
           FROM lote l
        ), custos AS (
         SELECT custo.lote_id,
            sum(custo.valor) AS custo_periodo_total
           FROM custo
          GROUP BY custo.lote_id
        ), base AS (
         SELECT l.id AS lote_id,
            l.fazenda_id,
            l.nome,
            l.fase,
            l.sistema,
            l.qtd_animais,
            l.rendimento_carcaca,
            l.data_saida,
            l.custo_compra_total,
            l.preco_arroba_praticado,
            l.peso_venda_kg,
            l.preco_arroba_venda,
            l.rendimento_venda,
            calc_arrobas(l.peso_venda_kg, COALESCE(l.rendimento_venda, l.rendimento_carcaca)) AS arrobas_venda_cab,
            ps.peso_inicial_kg,
            ps.peso_atual_kg,
            ps.data_inicial,
            ps.data_atual,
            ps.data_atual - ps.data_inicial AS dias_periodo,
            calc_arrobas(ps.peso_atual_kg, l.rendimento_carcaca) AS arrobas_atuais_cab,
            COALESCE(c.custo_periodo_total, 0::numeric) AS custo_periodo_total,
                CASE
                    WHEN l.qtd_animais > 0 THEN COALESCE(c.custo_periodo_total, 0::numeric) / l.qtd_animais::numeric
                    ELSE NULL::numeric
                END AS custo_periodo_cab,
                CASE
                    WHEN l.qtd_animais > 0 THEN COALESCE(l.custo_compra_total, 0::numeric) / l.qtd_animais::numeric
                    ELSE NULL::numeric
                END AS custo_compra_cab,
                CASE
                    WHEN l.qtd_animais > 0 THEN COALESCE(l.custo_compra_total, 0::numeric) / l.qtd_animais::numeric + COALESCE(c.custo_periodo_total, 0::numeric) / l.qtd_animais::numeric
                    ELSE NULL::numeric
                END AS custo_cab_total,
            calc_gmd(ps.peso_inicial_kg, ps.peso_atual_kg, NULLIF(ps.data_atual - ps.data_inicial, 0)::numeric) AS gmd,
            calc_custo_arroba_produzida(calc_peso_carcaca(ps.peso_inicial_kg, l.rendimento_carcaca), calc_peso_carcaca(ps.peso_atual_kg, l.rendimento_carcaca),
                CASE
                    WHEN l.qtd_animais > 0 THEN COALESCE(c.custo_periodo_total, 0::numeric) / l.qtd_animais::numeric
                    ELSE NULL::numeric
                END) AS custo_arroba_produzida,
            fz.preco_ref,
            fz.preco_ref_data
           FROM lote l
             JOIN pesos ps ON ps.lote_id = l.id
             LEFT JOIN custos c ON c.lote_id = l.id
             LEFT JOIN LATERAL ( SELECT ca.valor_rs AS preco_ref,
                                        ca.data     AS preco_ref_data
                   FROM fazenda f
                   LEFT JOIN LATERAL ( SELECT c2.valor_rs, c2.data
                           FROM cotacao_arroba c2
                          WHERE c2.praca = f.praca_referencia
                          ORDER BY c2.data DESC, c2.criado_em DESC
                         LIMIT 1) ca ON true
                  WHERE f.id = l.fazenda_id) fz ON true
        )
 SELECT lote_id,
    fazenda_id,
    nome,
    fase,
    sistema,
    qtd_animais,
    rendimento_carcaca,
    peso_inicial_kg,
    peso_atual_kg,
    data_inicial,
    data_atual,
    dias_periodo,
    gmd,
    arrobas_atuais_cab,
    custo_periodo_total,
    custo_periodo_cab,
    custo_compra_cab,
    custo_arroba_produzida,
    custo_cab_total,
    calc_preco_breakeven(custo_cab_total, arrobas_atuais_cab) AS preco_breakeven,
    preco_arroba_praticado,
    preco_ref AS preco_arroba_referencia,
    COALESCE(preco_arroba_praticado, preco_ref) AS preco_arroba_usado,
    calc_receita(arrobas_atuais_cab, COALESCE(preco_arroba_praticado, preco_ref)) AS receita_cab,
    calc_margem_total(arrobas_atuais_cab, COALESCE(preco_arroba_praticado, preco_ref), custo_cab_total) AS lucro_cab,
    calc_margem_por_arroba(arrobas_atuais_cab, COALESCE(preco_arroba_praticado, preco_ref), custo_cab_total) AS margem_por_arroba,
    calc_margem_total(arrobas_atuais_cab, COALESCE(preco_arroba_praticado, preco_ref), custo_cab_total) * COALESCE(qtd_animais, 0)::numeric AS lucro_lote_total,
    data_saida IS NULL AS ativo,
    data_saida,
    peso_venda_kg,
    preco_arroba_venda,
    rendimento_venda,
    arrobas_venda_cab,
        CASE
            WHEN preco_arroba_venda IS NOT NULL AND arrobas_venda_cab IS NOT NULL THEN calc_receita(arrobas_venda_cab, preco_arroba_venda)
            ELSE NULL::numeric
        END AS receita_venda_cab,
        CASE
            WHEN preco_arroba_venda IS NOT NULL AND arrobas_venda_cab IS NOT NULL THEN calc_receita(arrobas_venda_cab, preco_arroba_venda) * COALESCE(qtd_animais, 0)::numeric
            ELSE NULL::numeric
        END AS receita_venda_total,
    custo_cab_total * COALESCE(qtd_animais, 0)::numeric AS custo_lote_total,
        CASE
            WHEN preco_arroba_venda IS NOT NULL AND arrobas_venda_cab IS NOT NULL THEN calc_margem_total(arrobas_venda_cab, preco_arroba_venda, custo_cab_total)
            ELSE NULL::numeric
        END AS lucro_realizado_cab,
        CASE
            WHEN preco_arroba_venda IS NOT NULL AND arrobas_venda_cab IS NOT NULL THEN calc_margem_total(arrobas_venda_cab, preco_arroba_venda, custo_cab_total) * COALESCE(qtd_animais, 0)::numeric
            ELSE NULL::numeric
        END AS lucro_realizado_total,
    -- COLUNA NOVA (tem que ficar no fim): de quando é a cotação que sustentou
    -- todos os números acima. Null = não há cotação pra praça da fazenda.
    preco_ref_data AS preco_arroba_referencia_data
   FROM base;

comment on view public.vw_lote_analise is
  'Análise por lote. preco_arroba_referencia_data diz de quando é a cotação usada '
  'nos cálculos — a tela precisa mostrar essa data e avisar quando estiver velha, '
  'porque preço da @ é informação perecível.';
