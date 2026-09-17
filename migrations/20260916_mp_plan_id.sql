-- 16/09/2026 — Assinatura mensal COM plano associado no Mercado Pago.
--
-- Motivo: o checkout de preapproval SEM plano associado devolve um init_point
-- que não abre ("Esta página não existe"). A correção é criar um
-- preapproval_plan por faixa no MP e passar o preapproval_plan_id na criação
-- da assinatura. Esta coluna guarda o id desse plano, por faixa.
--
-- Fica em plano_faixa porque o workflow "Criar assinatura (Base 7)" já
-- consulta essa tabela pra pegar o preço — é só incluir a coluna no select.

alter table public.plano_faixa
  add column if not exists mp_plan_id_mensal text;

comment on column public.plano_faixa.mp_plan_id_mensal is
  'ID do preapproval_plan (assinatura recorrente mensal) no Mercado Pago. '
  'Preenchido pelo workflow n8n "CERTO AGRO — Sincronizar planos MP". '
  'Null = faixa ainda sem plano criado no gateway.';
