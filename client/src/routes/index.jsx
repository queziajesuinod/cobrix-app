import React, { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import ProtectedRoute from './ProtectedRoute'
import AppShell from '@/layouts/AppShell'
import AutoNotificationsPage from '@/features/notifications/AutoNotificationsPage'
import ManualNotificationsPage from '@/features/notifications/ManualNotificationsPage'

import CompanyCreatePage from '@/features/companies/CompanyCreatePage'
const LoginPage = lazy(() => import('@/features/auth/LoginPage'))
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage'))
const ClientsPage = lazy(() => import('@/features/clients/ClientsPage'))
const ContractsPage = lazy(() => import('@/features/contracts/ContractsPage'))
const CompanyListPage = lazy(() => import('@/features/companies/CompanyListPage'))
const CompanyFormPage = lazy(() => import('@/features/companies/CompanyFormPage'))
const CompanySettingsPage = lazy(() => import('@/features/companies/CompanySettingsPage'))
export default function AppRouter() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Carregando…</div>}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<ProtectedRoute><AppShell><DashboardPage /></AppShell></ProtectedRoute>} />
        <Route path="/dashboard" element={<ProtectedRoute><AppShell><DashboardPage /></AppShell></ProtectedRoute>} />
        <Route path="/companies" element={<ProtectedRoute><AppShell><CompanyListPage /></AppShell></ProtectedRoute>} />
        <Route path="/companies/new" element={<ProtectedRoute><AppShell><CompanyCreatePage /></AppShell></ProtectedRoute>} />

        <Route path="/companies/:id/settings" element={<ProtectedRoute><AppShell><CompanySettingsPage /></AppShell></ProtectedRoute>} />
        <Route path="/clients" element={<ProtectedRoute><AppShell><ClientsPage /></AppShell></ProtectedRoute>} />
        <Route path="/contracts" element={<ProtectedRoute><AppShell><ContractsPage /></AppShell></ProtectedRoute>} />
        <Route path="/notifications/auto" element={<ProtectedRoute><AppShell><AutoNotificationsPage /></AppShell></ProtectedRoute>} />
        <Route path="/notifications/manual" element={<ProtectedRoute><AppShell><ManualNotificationsPage /></AppShell></ProtectedRoute>} />

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  )
}
