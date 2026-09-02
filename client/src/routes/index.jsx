import React, { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import ProtectedRoute from './ProtectedRoute'
import AppShell from '@/layouts/AppShell'
const AutoNotificationsPage = lazy(() => import('@/features/notifications/AutoNotificationsPage'))
const MessageTemplatesPage = lazy(() => import('@/features/notifications/MessageTemplatesPage'))
const EvoConnectionPage = lazy(() => import('@/features/integration/EvoConnectionPage'))
const EmailConnectionPage = lazy(() => import('@/features/integration/EmailConnectionPage'))
const IntegrationsHubPage = lazy(() => import('@/features/integration/IntegrationsHubPage'))
const CompanyCreatePage = lazy(() => import('@/features/companies/CompanyCreatePage'))
const LoginPage = lazy(() => import('@/features/auth/LoginPage'))
const SignupPage = lazy(() => import('@/features/public/SignupPage'))
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage'))
const ClientsPage = lazy(() => import('@/features/clients/ClientsPage'))
const ClientFormPage = lazy(() => import('@/features/clients/ClientFormPage'))
const CadastroPage = lazy(() => import('@/features/cadastro/CadastroPage'))
const ContractsPage = lazy(() => import('@/features/contracts/ContractsPage'))
const ContractFormPage = lazy(() => import('@/features/contracts/ContractFormPage'))
const ContractTypesPage = lazy(() => import('@/features/contracts/ContractTypesPage'))
const PaidContractsPage = lazy(() => import('@/features/billings/PaidContractsPage'))
const OverdueClientsPage = lazy(() => import('@/features/reports/OverdueClientsPage'))
const RiskPortfolioPage = lazy(() => import('@/features/reports/RiskPortfolioPage'))
const PermissionsAdminPage = lazy(() => import('@/features/admin/PermissionsAdminPage'))
const PlansAdminPage = lazy(() => import('@/features/admin/PlansAdminPage'))
const CouponsPage = lazy(() => import('@/features/admin/CouponsPage'))
const SubscriptionsAdminPage = lazy(() => import('@/features/admin/SubscriptionsAdminPage'))
const MySubscriptionPage = lazy(() => import('@/features/account/MySubscriptionPage'))
const UsersPage = lazy(() => import('@/features/admin/UsersPage'))
const FinancePage = lazy(() => import('@/features/finance/FinancePage'))
const CommissionsPage = lazy(() => import('@/features/commissions/CommissionsPage'))
const PartnerPortalPage = lazy(() => import('@/features/companies/PartnerPortalPage'))
const TasksPage = lazy(() => import('@/features/tasks/TasksPage'))
const ProductivityPage = lazy(() => import('@/features/tasks/ProductivityPage'))
const FinanceDashboardPage = lazy(() => import('@/features/finance/FinanceDashboardPage'))
const SystemHealthPage = lazy(() => import('@/features/system/SystemHealthPage'))
const CompanyListPage = lazy(() => import('@/features/companies/CompanyListPage'))
const CompanyFormPage = lazy(() => import('@/features/companies/CompanyFormPage'))
const CompanySettingsPage = lazy(() => import('@/features/companies/CompanySettingsPage'))
const MyCompanyPage = lazy(() => import('@/features/companies/MyCompanyPage'))
export default function AppRouter() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Carregando…</div>}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/" element={<ProtectedRoute><AppShell><DashboardPage /></AppShell></ProtectedRoute>} />
        <Route path="/dashboard" element={<ProtectedRoute><AppShell><DashboardPage /></AppShell></ProtectedRoute>} />
        <Route path="/companies" element={<ProtectedRoute><AppShell><CompanyListPage /></AppShell></ProtectedRoute>} />
        <Route path="/companies/new" element={<ProtectedRoute><AppShell><CompanyCreatePage /></AppShell></ProtectedRoute>} />

        <Route path="/companies/:id/settings" element={<ProtectedRoute><AppShell><CompanySettingsPage /></AppShell></ProtectedRoute>} />
        <Route path="/minha-empresa" element={<ProtectedRoute><AppShell><MyCompanyPage /></AppShell></ProtectedRoute>} />
        <Route path="/cadastro" element={<ProtectedRoute><AppShell><CadastroPage /></AppShell></ProtectedRoute>} />
        <Route path="/clients" element={<ProtectedRoute><AppShell><ClientsPage /></AppShell></ProtectedRoute>} />
        <Route path="/clients/new" element={<ProtectedRoute><AppShell><ClientFormPage /></AppShell></ProtectedRoute>} />
        <Route path="/clients/:id/edit" element={<ProtectedRoute><AppShell><ClientFormPage /></AppShell></ProtectedRoute>} />
        <Route path="/contracts" element={<ProtectedRoute><AppShell><ContractsPage /></AppShell></ProtectedRoute>} />
        <Route path="/contracts/new" element={<ProtectedRoute><AppShell><ContractFormPage /></AppShell></ProtectedRoute>} />
        <Route path="/contracts/:id/edit" element={<ProtectedRoute><AppShell><ContractFormPage /></AppShell></ProtectedRoute>} />
        <Route path="/contracts/types" element={<ProtectedRoute><AppShell><ContractTypesPage /></AppShell></ProtectedRoute>} />
        <Route path="/notifications/auto" element={<ProtectedRoute><AppShell><AutoNotificationsPage /></AppShell></ProtectedRoute>} />
        <Route path="/notifications/templates" element={<ProtectedRoute><AppShell><MessageTemplatesPage /></AppShell></ProtectedRoute>} />
        <Route path="/billings/paid" element={<ProtectedRoute><AppShell><PaidContractsPage /></AppShell></ProtectedRoute>} />
        <Route path="/reports/overdue-clients" element={<ProtectedRoute><AppShell><OverdueClientsPage /></AppShell></ProtectedRoute>} />
        <Route path="/reports/risk" element={<ProtectedRoute><AppShell><RiskPortfolioPage /></AppShell></ProtectedRoute>} />
        <Route path="/system/health" element={<ProtectedRoute><AppShell><SystemHealthPage /></AppShell></ProtectedRoute>} />
        <Route path="/admin/permissions" element={<ProtectedRoute><AppShell><PermissionsAdminPage /></AppShell></ProtectedRoute>} />
        <Route path="/admin/plans" element={<ProtectedRoute><AppShell><PlansAdminPage /></AppShell></ProtectedRoute>} />
        <Route path="/admin/coupons" element={<ProtectedRoute><AppShell><CouponsPage /></AppShell></ProtectedRoute>} />
        <Route path="/admin/subscriptions" element={<ProtectedRoute><AppShell><SubscriptionsAdminPage /></AppShell></ProtectedRoute>} />
        <Route path="/minha-assinatura" element={<ProtectedRoute><AppShell><MySubscriptionPage /></AppShell></ProtectedRoute>} />
        <Route path="/admin/users" element={<ProtectedRoute><AppShell><UsersPage /></AppShell></ProtectedRoute>} />
        <Route path="/finance" element={<ProtectedRoute><AppShell><FinancePage /></AppShell></ProtectedRoute>} />
        <Route path="/commissions" element={<ProtectedRoute><AppShell><CommissionsPage /></AppShell></ProtectedRoute>} />
        <Route path="/partner" element={<ProtectedRoute><AppShell><PartnerPortalPage /></AppShell></ProtectedRoute>} />
        <Route path="/finance/dashboard" element={<ProtectedRoute><AppShell><FinanceDashboardPage /></AppShell></ProtectedRoute>} />
        <Route path="/tasks" element={<ProtectedRoute><AppShell><TasksPage /></AppShell></ProtectedRoute>} />
        <Route path="/tasks/productivity" element={<ProtectedRoute><AppShell><ProductivityPage /></AppShell></ProtectedRoute>} />
        <Route path="/integrations" element={<ProtectedRoute><AppShell><IntegrationsHubPage /></AppShell></ProtectedRoute>} />
        <Route path="/integration/evo" element={<ProtectedRoute><AppShell><EvoConnectionPage /></AppShell></ProtectedRoute>} />
        <Route path="/integration/email" element={<ProtectedRoute><AppShell><EmailConnectionPage /></AppShell></ProtectedRoute>} />

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  )
}
