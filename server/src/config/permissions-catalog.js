// server/src/config/permissions-catalog.js
//
// Catálogo único de permissões (fonte da verdade). Cada módulo agrupa uma
// permissão de acesso à tela (type 'view') e permissões de ação (type 'action',
// os botões daquela tela). Isto alimenta a matriz de perfis na UI, o seed dos
// perfis-modelo e a validação de chaves.

const CATALOG = [
  { module: 'dashboard', label: 'Início', permissions: [
    { key: 'dashboard.view', label: 'Acessar', type: 'view' },
  ] },
  { module: 'clients', label: 'Clientes', permissions: [
    { key: 'clients.view', label: 'Acessar', type: 'view' },
    { key: 'clients.create', label: 'Cadastrar', type: 'action' },
    { key: 'clients.edit', label: 'Editar', type: 'action' },
    { key: 'clients.toggle', label: 'Ativar/Inativar', type: 'action' },
  ] },
  { module: 'contracts', label: 'Contratos', permissions: [
    { key: 'contracts.view', label: 'Acessar', type: 'view' },
    { key: 'contracts.create', label: 'Cadastrar', type: 'action' },
    { key: 'contracts.edit', label: 'Editar', type: 'action' },
    { key: 'contracts.toggle', label: 'Ativar/Inativar', type: 'action' },
  ] },
  { module: 'contractTypes', label: 'Tipos de contrato', permissions: [
    { key: 'contractTypes.view', label: 'Acessar', type: 'view' },
    { key: 'contractTypes.manage', label: 'Criar / Editar / Excluir', type: 'action' },
  ] },
  { module: 'cadastro', label: 'Novo cadastro', permissions: [
    { key: 'cadastro.view', label: 'Acessar', type: 'view' },
  ] },
  { module: 'integration', label: 'Integração (WhatsApp/PIX)', permissions: [
    { key: 'integration.view', label: 'Acessar', type: 'view' },
    { key: 'integration.manage', label: 'Configurar', type: 'action' },
  ] },
  { module: 'notificationsAuto', label: 'Notificações automáticas', permissions: [
    { key: 'notifications.auto.view', label: 'Acessar', type: 'view' },
  ] },
  { module: 'templates', label: 'Modelos de mensagem', permissions: [
    { key: 'notifications.templates.view', label: 'Acessar', type: 'view' },
    { key: 'templates.edit', label: 'Editar modelos', type: 'action' },
  ] },
  { module: 'billingsPaid', label: 'Contratos pagos', permissions: [
    { key: 'billings.paid.view', label: 'Acessar', type: 'view' },
  ] },
  { module: 'overdue', label: 'Clientes em atraso', permissions: [
    { key: 'reports.overdue.view', label: 'Acessar', type: 'view' },
    { key: 'reports.export', label: 'Exportar CSV/Excel', type: 'action' },
  ] },
  { module: 'risk', label: 'Carteira em risco', permissions: [
    { key: 'reports.risk.view', label: 'Acessar', type: 'view' },
  ] },
  { module: 'billings', label: 'Cobranças (ações)', permissions: [
    { key: 'billings.notify', label: 'Enviar cobrança / forçar envio', type: 'action' },
    { key: 'billings.markPaid', label: 'Marcar pago / cancelar', type: 'action' },
  ] },
  { module: 'sensitive', label: 'Dados sensíveis (visualização)', permissions: [
    { key: 'data.viewValues', label: 'Ver valores em R$', type: 'data' },
    { key: 'data.viewPhone', label: 'Ver telefones', type: 'data' },
  ] },
  { module: 'users', label: 'Usuários', permissions: [
    { key: 'users.view', label: 'Ver usuários', type: 'view' },
    { key: 'users.create', label: 'Criar usuários (Operador/Somente leitura)', type: 'action' },
  ] },
  { module: 'finance', label: 'Gerenciador Financeiro', permissions: [
    { key: 'finance.revenues.view', label: 'Receitas: acessar', type: 'view' },
    { key: 'finance.revenues.manage', label: 'Receitas: lançar / editar / importar / estornar', type: 'action' },
    { key: 'finance.expenses.view', label: 'Despesas: acessar', type: 'view' },
    { key: 'finance.expenses.manage', label: 'Despesas: lançar / editar / importar', type: 'action' },
    { key: 'finance.dashboard.view', label: 'Dashboard: acessar (visão consolidada)', type: 'view' },
    { key: 'finance.metas.manage', label: 'Metas: definir orçado anual', type: 'action' },
  ] },
];

const ALL_KEYS = CATALOG.flatMap((m) => m.permissions.map((p) => p.key));
const ALL_KEYS_SET = new Set(ALL_KEYS);

function isValidPermission(key) {
  return ALL_KEYS_SET.has(key);
}

// Perfis-modelo semeados no primeiro boot.
const SEED_PROFILES = [
  { name: 'Administrador', is_system: true, permissions: [...ALL_KEYS] },
  {
    // Operador de cobrança: visualiza e cobra, sem ver valores/telefones e sem
    // editar registros sensíveis (o formulário de edição revelaria o dado).
    name: 'Operador',
    is_system: true,
    permissions: [
      'dashboard.view',
      'clients.view', 'clients.toggle',
      'contracts.view', 'contracts.toggle',
      'contractTypes.view',
      'notifications.auto.view',
      'notifications.templates.view',
      'billings.paid.view',
      'reports.overdue.view',
      'reports.risk.view',
      'billings.notify', 'billings.markPaid',
    ],
  },
  {
    name: 'Somente leitura',
    is_system: true,
    permissions: [
      'dashboard.view', 'clients.view', 'contracts.view', 'contractTypes.view',
      'notifications.auto.view', 'notifications.templates.view', 'billings.paid.view',
      'reports.overdue.view', 'reports.risk.view',
    ],
  },
];

module.exports = { CATALOG, ALL_KEYS, isValidPermission, SEED_PROFILES };
