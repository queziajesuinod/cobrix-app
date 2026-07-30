import { api } from '@/lib/api-client'

export const permissionsService = {
  me: async () => (await api.get('/permissions/me')).data,
  catalog: async () => (await api.get('/permissions/catalog')).data,
  listProfiles: async () => (await api.get('/permissions/profiles')).data,
  getProfile: async (id) => (await api.get(`/permissions/profiles/${id}`)).data,
  createProfile: async (name) => (await api.post('/permissions/profiles', { name })).data,
  renameProfile: async (id, name) => (await api.put(`/permissions/profiles/${id}`, { name })).data,
  setProfilePermissions: async (id, permissions) => (await api.put(`/permissions/profiles/${id}/permissions`, { permissions })).data,
  deleteProfile: async (id) => (await api.delete(`/permissions/profiles/${id}`)).data,
  listUsers: async () => (await api.get('/permissions/users')).data,
  setUserProfile: async (id, profileId) => (await api.put(`/permissions/users/${id}/profile`, { profileId })).data,
  getUserOverrides: async (id) => (await api.get(`/permissions/users/${id}/overrides`)).data,
  setUserOverrides: async (id, overrides) => (await api.put(`/permissions/users/${id}/overrides`, { overrides })).data,
  // Gestão de usuários por quem tem permissão (perfil Administrador)
  manageUsers: async () => (await api.get('/permissions/manage/users')).data,
  assignableProfiles: async () => (await api.get('/permissions/manage/assignable-profiles')).data,
  createUser: async (payload) => (await api.post('/permissions/manage/users', payload)).data,
  setManageUserProfile: async (id, profileId) => (await api.put(`/permissions/manage/users/${id}/profile`, { profileId })).data,
  setManageUserStatus: async (id, active) => (await api.patch(`/permissions/manage/users/${id}/status`, { active })).data,
  updateManageUser: async (id, payload) => (await api.put(`/permissions/manage/users/${id}`, payload)).data,
  manageCatalog: async () => (await api.get('/permissions/manage/catalog')).data,
  getManageUserOverrides: async (id) => (await api.get(`/permissions/manage/users/${id}/overrides`)).data,
  setManageUserOverrides: async (id, overrides) => (await api.put(`/permissions/manage/users/${id}/overrides`, { overrides })).data,
}

export default permissionsService
