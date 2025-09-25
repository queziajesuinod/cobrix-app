import React from 'react'
import { Grid, Card, CardContent, Typography } from '@mui/material'
export default function DashboardPage() {
  return (
    <Grid container spacing={2}>
      <Grid item xs={12} md={4}>
        <Card><CardContent><Typography variant="subtitle2">Bem-vindo ao Cobrix</Typography><Typography variant="h5" sx={{ fontWeight: 700 }}>Dashboard</Typography></CardContent></Card>
      </Grid>
    </Grid>
  )
}
