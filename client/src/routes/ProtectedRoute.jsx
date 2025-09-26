import React from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../features/auth/AuthContext'

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return null // ou spinner
  if (!user) return <Navigate to="/login" replace />
  return children || <Outlet />
}