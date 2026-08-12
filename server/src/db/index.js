const { Pool, types } = require('pg');
const { AsyncLocalStorage } = require('async_hooks');

// Por padrão o pg converte colunas DATE (OID 1082) para Date objects JavaScript
// definidos como midnight UTC. Com qualquer timezone brasileiro (UTC-3 / UTC-4)
// isso causa um off-by-one: '2024-03-01T00:00:00Z' vira 29/02 no horário local.
// Solução: receber DATE como string 'YYYY-MM-DD' — ensureDateOnly() já trata isso.
types.setTypeParser(1082, (val) => val);

// Fuso da aplicação (padrão Campo Grande, UTC-4). Toda conexão do pool nasce nele
// via startup option — assim now()::date, current_date e timestamptz::date usam a
// data LOCAL. Sem isso o banco fica em UTC e um pagamento marcado à noite (ex.: 21h)
// é gravado no dia seguinte (e, na virada, no mês seguinte).
const APP_TZ = process.env.TZ || 'America/Campo_Grande';

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  max: Number(process.env.DB_POOL_MAX || 20),
  idleTimeoutMillis: 30000,
  // Falha rápido em vez de pendurar a request se o pool estiver esgotado.
  connectionTimeoutMillis: Number(process.env.DB_POOL_CONN_TIMEOUT_MS || 10000),
  options: `-c timezone=${APP_TZ}`,
});
const schema = (process.env.DB_SCHEMA || 'public').replace(/[^a-zA-Z0-9_]/g,'');

const als = new AsyncLocalStorage();

async function initDb() {
  await withClient(async (c) => {
    await c.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await c.query(`SET search_path TO ${schema}`);
    await c.query(`
      CREATE TABLE IF NOT EXISTS companies (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        pix_key TEXT,
        evo_instance TEXT,
        clients_limit INTEGER,
        contracts_limit INTEGER,
        efi_client_id_enc TEXT,
        efi_client_secret_enc TEXT,
        efi_cert_base64_enc TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    await c.query(`ALTER TABLE ${schema}.companies ADD COLUMN IF NOT EXISTS pix_key TEXT;`);
    await c.query(`ALTER TABLE ${schema}.companies ADD COLUMN IF NOT EXISTS evo_instance TEXT;`);
    await c.query(`ALTER TABLE ${schema}.companies ADD COLUMN IF NOT EXISTS clients_limit INTEGER;`);
    await c.query(`ALTER TABLE ${schema}.companies ADD COLUMN IF NOT EXISTS contracts_limit INTEGER;`);
    await c.query(`ALTER TABLE ${schema}.companies ADD COLUMN IF NOT EXISTS efi_client_id_enc TEXT;`);
    await c.query(`ALTER TABLE ${schema}.companies ADD COLUMN IF NOT EXISTS efi_client_secret_enc TEXT;`);
    // Integração de e-mail (SMTP por empresa) — senha cifrada via secret-box.
    // email_provider: 'smtp' (manual) ou 'gmail' (preset smtp.gmail.com + senha de app).
    await c.query(`ALTER TABLE ${schema}.companies ADD COLUMN IF NOT EXISTS email_provider TEXT NOT NULL DEFAULT 'smtp';`);
    await c.query(`ALTER TABLE ${schema}.companies ADD COLUMN IF NOT EXISTS email_smtp_host TEXT;`);
    await c.query(`ALTER TABLE ${schema}.companies ADD COLUMN IF NOT EXISTS email_smtp_port INTEGER;`);
    await c.query(`ALTER TABLE ${schema}.companies ADD COLUMN IF NOT EXISTS email_smtp_user TEXT;`);
    await c.query(`ALTER TABLE ${schema}.companies ADD COLUMN IF NOT EXISTS email_smtp_pass_enc TEXT;`);
    await c.query(`ALTER TABLE ${schema}.companies ADD COLUMN IF NOT EXISTS email_from TEXT;`);
    await c.query(`ALTER TABLE ${schema}.companies ADD COLUMN IF NOT EXISTS email_secure BOOLEAN NOT NULL DEFAULT false;`);
    await c.query(`ALTER TABLE ${schema}.companies ADD COLUMN IF NOT EXISTS email_enabled BOOLEAN NOT NULL DEFAULT false;`);
    await c.query(`ALTER TABLE ${schema}.companies ADD COLUMN IF NOT EXISTS efi_cert_base64_enc TEXT;`);
    // Usuários e vínculo com empresas (idempotente — a definição vivia no init legado).
    await c.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.users (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('master','admin','user')),
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await c.query(`ALTER TABLE ${schema}.users ADD COLUMN IF NOT EXISTS name TEXT;`);
    await c.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.user_companies (
        user_id INTEGER NOT NULL REFERENCES ${schema}.users(id) ON DELETE CASCADE,
        company_id INTEGER NOT NULL REFERENCES ${schema}.companies(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, company_id)
      );
    `);
    // --- SaaS: catálogo de planos (Fase 1) ---
    // Um plano define preço (mensal/anual), cotas e o TETO de acesso
    // (permission_keys) que limita o que a empresa-cliente enxerga. Ver
    // services/permissions.js (interseção do teto). Empresa sem plano = acesso
    // total (sem teto), para não afetar as empresas já existentes.
    await c.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.plans (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        price_monthly NUMERIC(14,2),
        price_annual NUMERIC(14,2),
        clients_limit INTEGER,
        contracts_limit INTEGER,
        permission_keys TEXT[] NOT NULL DEFAULT '{}',
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ,
        created_by INTEGER REFERENCES ${schema}.users(id)
      );
    `);
    await c.query(`ALTER TABLE ${schema}.companies ADD COLUMN IF NOT EXISTS plan_id INTEGER REFERENCES ${schema}.plans(id);`);
    await c.query(`ALTER TABLE ${schema}.companies ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';`);
    // Empresa "dona" do SaaS: onde vivem os clientes/contratos das assinaturas e
    // para onde vão os pagamentos. Só uma empresa deve ter is_saas_owner = true.
    await c.query(`ALTER TABLE ${schema}.companies ADD COLUMN IF NOT EXISTS is_saas_owner BOOLEAN NOT NULL DEFAULT false;`);
    // Assinatura: liga a empresa-cliente provisionada ao seu plano e ao
    // contrato/cliente criados no tenant do owner. É por aqui que a ativação
    // (Fase 3) sabe qual empresa liberar quando o pagamento confirma.
    await c.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.company_subscriptions (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES ${schema}.companies(id) ON DELETE CASCADE,
        plan_id INTEGER REFERENCES ${schema}.plans(id),
        period TEXT NOT NULL DEFAULT 'monthly',
        owner_company_id INTEGER REFERENCES ${schema}.companies(id),
        client_id INTEGER,
        contract_id INTEGER,
        partner_id INTEGER,
        campaign_id INTEGER,
        promo_code TEXT,
        status TEXT NOT NULL DEFAULT 'pending_payment',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        activated_at TIMESTAMPTZ
      );
    `);
    // Cancelamento com carência: 'canceling' mantém o acesso até access_until;
    // o cron subscription-lifecycle efetiva a inativação depois dessa data.
    await c.query(`ALTER TABLE ${schema}.company_subscriptions ADD COLUMN IF NOT EXISTS access_until DATE;`);
    await c.query(`ALTER TABLE ${schema}.company_subscriptions ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ;`);
    await c.query(`
      CREATE TABLE IF NOT EXISTS clients (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        responsavel TEXT,
        document_cpf TEXT,
        document_cnpj TEXT,
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    await c.query(`ALTER TABLE ${schema}.clients ADD COLUMN IF NOT EXISTS responsavel TEXT;`);
    await c.query(`ALTER TABLE ${schema}.clients ADD COLUMN IF NOT EXISTS document_cpf TEXT;`);
    await c.query(`ALTER TABLE ${schema}.clients ADD COLUMN IF NOT EXISTS document_cnpj TEXT;`);
    await c.query(`ALTER TABLE ${schema}.clients ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;`);
    await c.query(`
      CREATE TABLE IF NOT EXISTS message_templates (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        template TEXT NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE (company_id, type)
      );
    `);
    await c.query(`
      CREATE TABLE IF NOT EXISTS billings (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
        billing_date DATE NOT NULL,
        amount NUMERIC(14,2) NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        gateway_txid TEXT,
        gateway_paid_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ,
        UNIQUE(contract_id, billing_date)
      );
    `);
    await c.query(`ALTER TABLE ${schema}.billings ADD COLUMN IF NOT EXISTS gateway_txid TEXT;`);
    await c.query(`ALTER TABLE ${schema}.billings ADD COLUMN IF NOT EXISTS gateway_paid_at TIMESTAMPTZ;`);
    // billings.js/finance.js gravam updated_at ao marcar pago/editar/estornar. Sem
    // esta coluna essas escritas lançavam erro — e, como não há transação, o mês
    // ficava 'paid' em contract_month_status SEM cobrança paga (não gerava receita).
    await c.query(`ALTER TABLE ${schema}.billings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;`);
    await c.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.billing_gateway_links (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES ${schema}.companies(id) ON DELETE CASCADE,
        contract_id INTEGER NOT NULL REFERENCES ${schema}.contracts(id) ON DELETE CASCADE,
        billing_id INTEGER REFERENCES ${schema}.billings(id) ON DELETE SET NULL,
        due_date DATE NOT NULL,
        txid TEXT,
        loc_id TEXT,
        payment_link TEXT,
        copy_paste TEXT,
        qr_code TEXT,
        amount NUMERIC(14,2),
        status TEXT,
        expires_at TIMESTAMPTZ,
        paid_at TIMESTAMPTZ,
        gateway_payload JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (company_id, contract_id, due_date)
      );
    `);
    await c.query(`ALTER TABLE ${schema}.billing_gateway_links ADD COLUMN IF NOT EXISTS billing_id INTEGER REFERENCES ${schema}.billings(id) ON DELETE SET NULL;`);
    await c.query(`ALTER TABLE ${schema}.billing_gateway_links ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;`);
    await c.query(`ALTER TABLE ${schema}.contracts ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;`);
    await c.query(`ALTER TABLE ${schema}.contracts ADD COLUMN IF NOT EXISTS billing_mode TEXT NOT NULL DEFAULT 'monthly';`);
    await c.query(`ALTER TABLE ${schema}.contracts ADD COLUMN IF NOT EXISTS billing_interval_days INTEGER;`);
    await c.query(`UPDATE ${schema}.contracts SET billing_mode = 'monthly' WHERE billing_mode IS NULL;`);
    await c.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.contract_custom_billings (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES ${schema}.companies(id) ON DELETE CASCADE,
        contract_id INTEGER NOT NULL REFERENCES ${schema}.contracts(id) ON DELETE CASCADE,
        billing_date DATE NOT NULL,
        amount NUMERIC(14,2),
        percentage NUMERIC(6,2),
        created_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE (contract_id, billing_date)
      );
    `);
    await c.query(`ALTER TABLE ${schema}.contract_custom_billings ALTER COLUMN amount DROP NOT NULL;`);
    await c.query(`ALTER TABLE ${schema}.contract_custom_billings ADD COLUMN IF NOT EXISTS percentage NUMERIC(6,2);`);

    // Tabela de notificações (criada aqui caso não exista ainda)
    await c.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.billing_notifications (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES ${schema}.companies(id) ON DELETE CASCADE,
        billing_id INTEGER REFERENCES ${schema}.billings(id) ON DELETE SET NULL,
        contract_id INTEGER NOT NULL REFERENCES ${schema}.contracts(id) ON DELETE CASCADE,
        client_id INTEGER REFERENCES ${schema}.clients(id) ON DELETE SET NULL,
        kind TEXT NOT NULL,
        target_date DATE,
        status TEXT NOT NULL DEFAULT 'pending',
        provider TEXT,
        to_number TEXT,
        message TEXT,
        provider_status INTEGER,
        provider_response TEXT,
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        sent_at TIMESTAMPTZ,
        type TEXT,
        due_date DATE,
        retry_count INTEGER NOT NULL DEFAULT 0,
        next_retry_at TIMESTAMPTZ
      );
    `);
    // Colunas de retry em tabelas já existentes (idempotente — precisa vir antes do índice)
    await c.query(`ALTER TABLE ${schema}.billing_notifications ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;`);
    await c.query(`ALTER TABLE ${schema}.billing_notifications ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;`);

    // Backfill: preenche type=NULL com o valor de kind quando kind é 'pre','due','late'.
    // Isso acontece quando a coluna 'type' foi adicionada depois dos registros existirem.
    // Sem esse fix, o overview agrupa por type=NULL e os chips nunca pintam.
    await c.query(`
      UPDATE ${schema}.billing_notifications
         SET type = kind
       WHERE type IS NULL
         AND kind IN ('pre','due','late');
    `);

    // Antes de criar o índice único, remove duplicatas mantendo o registro mais recente
    // de cada grupo (company_id, contract_id, kind, due_date).
    // Isso é necessário porque registros anteriores podem ter sido inseridos sem constraint.
    await c.query(`
      DELETE FROM ${schema}.billing_notifications
      WHERE id IN (
        SELECT id FROM (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY company_id, contract_id, kind, due_date
                   ORDER BY id DESC
                 ) AS rn
          FROM ${schema}.billing_notifications
          WHERE due_date IS NOT NULL
        ) sub
        WHERE rn > 1
      );
    `);

    // Índice único: uma notificação por (empresa, contrato, tipo, data_vencimento)
    await c.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_bn_company_contract_kind_due
        ON ${schema}.billing_notifications (company_id, contract_id, kind, due_date)
        WHERE due_date IS NOT NULL;
    `);

    // Limpeza de constraints/índices ÚNICOS LEGADOS divergentes.
    // Existiam uniqueness por (contract, target_date, kind) e por (contract, type, due_month)
    // que NÃO correspondem ao ON CONFLICT do código (por due_date). Isso causava
    // unique_violation engolidos em cenários com múltiplas notificações. Mantemos apenas
    // uq_bn_company_contract_kind_due. Idempotente e seguro (remover uniqueness nunca
    // viola dados existentes).
    await c.query(`ALTER TABLE ${schema}.billing_notifications
      DROP CONSTRAINT IF EXISTS billing_notifications_company_id_contract_id_target_date_ki_key;`);
    await c.query(`DROP INDEX IF EXISTS ${schema}.idx_bn_auto_one_per_day_kind;`);
    await c.query(`DROP INDEX IF EXISTS ${schema}.billing_notifications_company_id_contract_id_type_due_month_idx;`);
    await c.query(`DROP INDEX IF EXISTS ${schema}.uq_bn_auto_one_per_kind_month;`);
    // Índice para queries de retry
    await c.query(`
      CREATE INDEX IF NOT EXISTS idx_bn_retry
        ON ${schema}.billing_notifications (status, retry_count, created_at)
        WHERE status = 'failed';
    `);
    await c.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.system_cron_runs (
        job_name TEXT PRIMARY KEY,
        schedule_expression TEXT,
        last_started_at TIMESTAMPTZ,
        last_finished_at TIMESTAMPTZ,
        last_status TEXT NOT NULL DEFAULT 'never',
        last_error TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await c.query(`ALTER TABLE ${schema}.system_cron_runs ADD COLUMN IF NOT EXISTS schedule_expression TEXT;`);
    await c.query(`ALTER TABLE ${schema}.system_cron_runs ADD COLUMN IF NOT EXISTS last_started_at TIMESTAMPTZ;`);
    await c.query(`ALTER TABLE ${schema}.system_cron_runs ADD COLUMN IF NOT EXISTS last_finished_at TIMESTAMPTZ;`);
    await c.query(`ALTER TABLE ${schema}.system_cron_runs ADD COLUMN IF NOT EXISTS last_status TEXT NOT NULL DEFAULT 'never';`);
    await c.query(`ALTER TABLE ${schema}.system_cron_runs ADD COLUMN IF NOT EXISTS last_error TEXT;`);
    await c.query(`ALTER TABLE ${schema}.system_cron_runs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();`);

    // Notificações in-app (sino do topo). Geradas por empresa; estado de "lido" por usuário.
    await c.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.notifications (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES ${schema}.companies(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        ref_type TEXT,
        ref_id INTEGER,
        link TEXT,
        dedup_key TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (company_id, dedup_key)
      );
    `);
    await c.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_company_created
        ON ${schema}.notifications (company_id, created_at DESC);
    `);
    await c.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.notification_reads (
        notification_id INTEGER NOT NULL REFERENCES ${schema}.notifications(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES ${schema}.users(id) ON DELETE CASCADE,
        read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (notification_id, user_id)
      );
    `);
    // Destinatário opcional: user_id nulo = notificação da empresa (todos veem);
    // preenchido = notificação PESSOAL (só aquele usuário vê no sininho).
    await c.query(`ALTER TABLE ${schema}.notifications ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES ${schema}.users(id) ON DELETE CASCADE;`);

    // Perfis e permissões (RBAC configurável). Perfis são GLOBAIS; o vínculo do
    // usuário ao perfil fica em users.profile_id; overrides por usuário afinam
    // permissões específicas além do perfil.
    await c.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.profiles (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        is_system BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await c.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.profile_permissions (
        profile_id INTEGER NOT NULL REFERENCES ${schema}.profiles(id) ON DELETE CASCADE,
        permission_key TEXT NOT NULL,
        PRIMARY KEY (profile_id, permission_key)
      );
    `);
    await c.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.user_permission_overrides (
        user_id INTEGER NOT NULL REFERENCES ${schema}.users(id) ON DELETE CASCADE,
        permission_key TEXT NOT NULL,
        allowed BOOLEAN NOT NULL,
        PRIMARY KEY (user_id, permission_key)
      );
    `);
    await c.query(`ALTER TABLE ${schema}.users ADD COLUMN IF NOT EXISTS profile_id INTEGER REFERENCES ${schema}.profiles(id) ON DELETE SET NULL;`);
    // Quem cadastrou o usuário — permite ao Administrador personalizar permissões
    // apenas dos usuários que ele mesmo criou.
    await c.query(`ALTER TABLE ${schema}.users ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES ${schema}.users(id) ON DELETE SET NULL;`);

    // Auditoria nos cadastros principais: quem criou/editou e quando.
    for (const t of ['clients', 'contracts', 'contract_types']) {
      await c.query(`ALTER TABLE ${schema}.${t} ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();`);
      await c.query(`ALTER TABLE ${schema}.${t} ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;`);
      await c.query(`ALTER TABLE ${schema}.${t} ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES ${schema}.users(id) ON DELETE SET NULL;`);
      await c.query(`ALTER TABLE ${schema}.${t} ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES ${schema}.users(id) ON DELETE SET NULL;`);
      // Backfill: registros antigos ficam com o admin (master) da empresa como criador.
      await c.query(`
        UPDATE ${schema}.${t} tt SET created_by = (
          SELECT u.id FROM ${schema}.user_companies uc
          JOIN ${schema}.users u ON u.id = uc.user_id
          WHERE uc.company_id = tt.company_id
          ORDER BY (u.role = 'master') DESC, u.id ASC
          LIMIT 1
        ) WHERE tt.created_by IS NULL;
      `);
    }

    // Gerenciador Financeiro: receitas (avulsas) e despesas (com recorrência mensal).
    await c.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.finance_revenues (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES ${schema}.companies(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        description TEXT,
        amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        received_at DATE NOT NULL,
        created_by INTEGER REFERENCES ${schema}.users(id) ON DELETE SET NULL,
        updated_by INTEGER REFERENCES ${schema}.users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ
      );
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_fin_rev_company_date ON ${schema}.finance_revenues (company_id, received_at DESC);`);
    await c.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.finance_expenses (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES ${schema}.companies(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        description TEXT,
        amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        paid_at DATE NOT NULL,
        is_recurring BOOLEAN NOT NULL DEFAULT false,
        recurrence_active BOOLEAN NOT NULL DEFAULT true,
        recurrence_of INTEGER REFERENCES ${schema}.finance_expenses(id) ON DELETE SET NULL,
        created_by INTEGER REFERENCES ${schema}.users(id) ON DELETE SET NULL,
        updated_by INTEGER REFERENCES ${schema}.users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ
      );
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_fin_exp_company_date ON ${schema}.finance_expenses (company_id, paid_at DESC);`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_fin_exp_recurrence ON ${schema}.finance_expenses (recurrence_of);`);
    // Tipo de despesa: 'fixed' (fixa) ou 'variable' (variável) — para diferenciar em gráfico.
    await c.query(`ALTER TABLE ${schema}.finance_expenses ADD COLUMN IF NOT EXISTS expense_type TEXT NOT NULL DEFAULT 'variable';`);
    // Situação de pagamento: 'paid' (paga, desconta do saldo) ou 'pending' (a pagar).
    // Default 'paid' mantém o histórico existente como pago; só as ocorrências geradas
    // pela recorrência nascem 'pending' até serem confirmadas como pagas.
    await c.query(`ALTER TABLE ${schema}.finance_expenses ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'paid';`);

    // Metas financeiras anuais (orçado) por empresa: 1 linha por ano.
    await c.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.finance_metas (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES ${schema}.companies(id) ON DELETE CASCADE,
        ano SMALLINT NOT NULL,
        meta_honorarios NUMERIC(14,2) NOT NULL DEFAULT 0,
        meta_despesas NUMERIC(14,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ,
        created_by INTEGER REFERENCES ${schema}.users(id) ON DELETE SET NULL,
        updated_by INTEGER REFERENCES ${schema}.users(id) ON DELETE SET NULL,
        UNIQUE (company_id, ano)
      );
    `);

    // Itens de menu "Novo" já vistos por cada usuário (esconde a etiqueta ao abrir).
    await c.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.user_seen_menu (
        user_id INTEGER NOT NULL REFERENCES ${schema}.users(id) ON DELETE CASCADE,
        item_key TEXT NOT NULL,
        seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, item_key)
      );
    `);

    // Vínculo opcional de receita a cliente/contrato.
    await c.query(`ALTER TABLE ${schema}.finance_revenues ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES ${schema}.clients(id) ON DELETE SET NULL;`);
    await c.query(`ALTER TABLE ${schema}.finance_revenues ADD COLUMN IF NOT EXISTS contract_id INTEGER REFERENCES ${schema}.contracts(id) ON DELETE SET NULL;`);

    // Auditoria em companies e message_templates.
    for (const t of ['companies', 'message_templates']) {
      await c.query(`ALTER TABLE ${schema}.${t} ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();`);
      await c.query(`ALTER TABLE ${schema}.${t} ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;`);
      await c.query(`ALTER TABLE ${schema}.${t} ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES ${schema}.users(id) ON DELETE SET NULL;`);
      await c.query(`ALTER TABLE ${schema}.${t} ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES ${schema}.users(id) ON DELETE SET NULL;`);
    }
    await c.query(`
      UPDATE ${schema}.companies co SET created_by = (
        SELECT u.id FROM ${schema}.user_companies uc JOIN ${schema}.users u ON u.id = uc.user_id
        WHERE uc.company_id = co.id ORDER BY (u.role='master') DESC, u.id ASC LIMIT 1
      ) WHERE co.created_by IS NULL;
    `);
    await c.query(`
      UPDATE ${schema}.message_templates mt SET created_by = (
        SELECT u.id FROM ${schema}.user_companies uc JOIN ${schema}.users u ON u.id = uc.user_id
        WHERE uc.company_id = mt.company_id ORDER BY (u.role='master') DESC, u.id ASC LIMIT 1
      ) WHERE mt.created_by IS NULL;
    `);

    // ===================== GERENCIADOR DE TAREFAS (rotinas → tarefas → subtarefas) =====================
    // Modelo do fluxograma: board HÍBRIDO (raias = grupos/rotinas × colunas = etapas),
    // árvore de tarefas recursiva (parent_id), prioridade em 4 níveis, recorrência
    // mensal/anual e papel Gestor (permissão tasks.gestor).

    // Remove o modelo antigo (Kanban por equipe/coluna/modelos). CASCADE limpa dependências.
    await c.query(`ALTER TABLE ${schema}.contract_types DROP COLUMN IF EXISTS default_task_model_id;`);
    for (const t of ['task_activity', 'task_items', 'task_cards', 'task_model_items', 'task_models', 'task_columns', 'task_team_members', 'task_teams']) {
      await c.query(`DROP TABLE IF EXISTS ${schema}.${t} CASCADE;`);
    }

    // Etapas de progresso (colunas do Kanban). Por empresa, ordenadas; is_done = etapa final.
    await c.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.task_stages (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES ${schema}.companies(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        is_done BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    // Grupos/Rotinas = raias do board. recurring=true → rotina fixa. Tarefa com
    // group_id nulo aparece na raia "Avulsas".
    await c.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.task_groups (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES ${schema}.companies(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        recurring BOOLEAN NOT NULL DEFAULT true,
        default_assignee_id INTEGER REFERENCES ${schema}.users(id) ON DELETE SET NULL,
        default_priority TEXT NOT NULL DEFAULT 'media' CHECK (default_priority IN ('baixa','media','alta','urgente')),
        position INTEGER NOT NULL DEFAULT 0,
        created_by INTEGER REFERENCES ${schema}.users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ
      );
    `);
    // Tarefas E subtarefas numa ÁRVORE (parent_id, profundidade livre). kind: avulsa|fixa.
    // Recorrência: none|monthly|yearly (+ dia/mês). is_template = definição da rotina;
    // as ocorrências geradas apontam para a definição via source_node_id.
    await c.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.task_nodes (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES ${schema}.companies(id) ON DELETE CASCADE,
        group_id INTEGER REFERENCES ${schema}.task_groups(id) ON DELETE CASCADE,
        parent_id INTEGER REFERENCES ${schema}.task_nodes(id) ON DELETE CASCADE,
        stage_id INTEGER REFERENCES ${schema}.task_stages(id) ON DELETE SET NULL,
        kind TEXT NOT NULL DEFAULT 'avulsa' CHECK (kind IN ('avulsa','fixa')),
        title TEXT NOT NULL,
        description TEXT,
        assignee_id INTEGER REFERENCES ${schema}.users(id) ON DELETE SET NULL,
        priority TEXT NOT NULL DEFAULT 'media' CHECK (priority IN ('baixa','media','alta','urgente')),
        due_date DATE,
        recurrence TEXT NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none','monthly','yearly')),
        recurrence_day INTEGER,
        recurrence_month INTEGER,
        is_template BOOLEAN NOT NULL DEFAULT false,
        source_node_id INTEGER REFERENCES ${schema}.task_nodes(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
        position INTEGER NOT NULL DEFAULT 0,
        client_id INTEGER REFERENCES ${schema}.clients(id) ON DELETE SET NULL,
        contract_id INTEGER REFERENCES ${schema}.contracts(id) ON DELETE SET NULL,
        started_at TIMESTAMPTZ,
        done_at TIMESTAMPTZ,
        done_by INTEGER REFERENCES ${schema}.users(id) ON DELETE SET NULL,
        created_by INTEGER REFERENCES ${schema}.users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ
      );
    `);
    // Histórico por tarefa (criou, moveu de etapa, concluiu, gerou ocorrência…).
    await c.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.task_node_activity (
        id SERIAL PRIMARY KEY,
        node_id INTEGER NOT NULL REFERENCES ${schema}.task_nodes(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES ${schema}.users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        detail TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    // Etiquetas/labels por empresa + vínculo N:N com as tarefas (categorização transversal).
    await c.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.task_labels (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES ${schema}.companies(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#64748b',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await c.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.task_node_labels (
        node_id INTEGER NOT NULL REFERENCES ${schema}.task_nodes(id) ON DELETE CASCADE,
        label_id INTEGER NOT NULL REFERENCES ${schema}.task_labels(id) ON DELETE CASCADE,
        PRIMARY KEY (node_id, label_id)
      );
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_task_node_labels_label ON ${schema}.task_node_labels (label_id);`);
    // Modelos de checklist (passo-a-passo reutilizável) por empresa.
    await c.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.task_checklists (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES ${schema}.companies(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        steps TEXT[] NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ
      );
    `);
    // Comentários (discussão) da tarefa — separado do histórico de sistema.
    await c.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.task_comments (
        id SERIAL PRIMARY KEY,
        node_id INTEGER NOT NULL REFERENCES ${schema}.task_nodes(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES ${schema}.users(id) ON DELETE SET NULL,
        body TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ
      );
    `);
    // Vínculo opcional a cliente/contrato é SÓ da tarefa (rotina é geral do quadro).
    await c.query(`ALTER TABLE ${schema}.task_nodes ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES ${schema}.clients(id) ON DELETE SET NULL;`);
    await c.query(`ALTER TABLE ${schema}.task_groups DROP COLUMN IF EXISTS client_id;`);
    await c.query(`ALTER TABLE ${schema}.task_groups DROP COLUMN IF EXISTS contract_id;`);
    // Recorrência: passa a aceitar semanal/quinzenal (recurrence_day = dia da semana 0-6
    // quando weekly/biweekly) e permite pausar a geração de novas ocorrências.
    await c.query(`ALTER TABLE ${schema}.task_nodes DROP CONSTRAINT IF EXISTS task_nodes_recurrence_check;`);
    await c.query(`ALTER TABLE ${schema}.task_nodes ADD CONSTRAINT task_nodes_recurrence_check CHECK (recurrence IN ('none','weekly','biweekly','monthly','yearly'));`);
    await c.query(`ALTER TABLE ${schema}.task_nodes ADD COLUMN IF NOT EXISTS recurrence_paused BOOLEAN NOT NULL DEFAULT false;`);
    // Exclusão lógica (soft delete) da tarefa/subtarefa: fica INATIVA (some do quadro,
    // minhas tarefas, calendário e produtividade) mas guarda quem/quando "excluiu"
    // para auditoria. O Gestor pode restaurar pela "Lixeira".
    await c.query(`ALTER TABLE ${schema}.task_nodes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;`);
    await c.query(`ALTER TABLE ${schema}.task_nodes ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES ${schema}.users(id) ON DELETE SET NULL;`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_task_nodes_deleted ON ${schema}.task_nodes (company_id, deleted_at);`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_task_nodes_group ON ${schema}.task_nodes (company_id, group_id);`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_task_nodes_parent ON ${schema}.task_nodes (parent_id);`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_task_nodes_assignee ON ${schema}.task_nodes (assignee_id, status);`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_task_stages_company ON ${schema}.task_stages (company_id, position);`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_task_node_activity ON ${schema}.task_node_activity (node_id, created_at DESC);`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_task_comments_node ON ${schema}.task_comments (node_id, created_at);`);
    // Menções (@) num comentário → concede acesso à tarefa e gera notificação pessoal.
    await c.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.task_comment_mentions (
        comment_id INTEGER NOT NULL REFERENCES ${schema}.task_comments(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES ${schema}.users(id) ON DELETE CASCADE,
        PRIMARY KEY (comment_id, user_id)
      );
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_task_comment_mentions_user ON ${schema}.task_comment_mentions (user_id);`);
  });
}

function getStoreClient() {
  const store = als.getStore();
  return store?.client || null;
}

async function withClient(fn) {
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO ${schema}`);
    return await fn(client);
  } finally {
    client.release();
  }
}

async function query(text, params) {
  const c = getStoreClient();
  if (c) return c.query(text, params);
  // withClient garante que SET search_path e a query usam a mesma conexão
  return withClient((client) => client.query(text, params));
}

// Middleware: attach request-scoped client + set app.company_id
async function dbRequestContext(req, res, next) {
  const cidHeader = req.header('X-Company-Id');
  const companyId = cidHeader ? parseInt(cidHeader, 10) : null;

  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO ${schema}`);
    if (companyId && Number.isInteger(companyId)) {
      await client.query(`SELECT set_config('app.company_id', $1, false)`, [String(companyId)]);
      req.companyId = companyId;
    } else {
      await client.query(`RESET app.company_id`);
      req.companyId = null;
    }

    als.run({ client }, () => {
      res.on('finish', async () => {
        try { await client.query('RESET app.company_id'); } catch {}
        client.release();
      });
      next();
    });
  } catch (e) {
    client.release();
    next(e);
  }
}

module.exports = { pool, initDb, withClient, query, dbRequestContext };
