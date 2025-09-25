import React from 'react'
import { Grid, Card, CardContent, Typography } from '@mui/material'

function KCard({ label, value }){
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="overline" color="text.secondary">{label}</Typography>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>{value}</Typography>
      </CardContent>
    </Card>
  )
}

export default function KpiCards({ k }){
  return (
    <Grid container spacing={2}>
      <Grid item xs={6} md={3}><KCard label="Contratos ativos" value={k.contractsActive ?? 0} /></Grid>
      <Grid item xs={6} md={3}><KCard label="Meses pagos" value={k.monthsPaid ?? 0} /></Grid>
      <Grid item xs={6} md={3}><KCard label="Meses pendentes" value={k.monthsPending ?? 0} /></Grid>
      <Grid item xs={6} md={3}><KCard label="Meses cancelados" value={k.monthsCanceled ?? 0} /></Grid>

      <Grid item xs={6} md={3}><KCard label="Cobranças totais" value={k.billingsTotal ?? 0} /></Grid>
      <Grid item xs={6} md={3}><KCard label="Cobranças pagas" value={k.billingsPaid ?? 0} /></Grid>
      <Grid item xs={6} md={3}><KCard label="Cobranças pendentes" value={k.billingsPending ?? 0} /></Grid>
      <Grid item xs={6} md={3}><KCard label="Cobranças canceladas" value={k.billingsCanceled ?? 0} /></Grid>
    </Grid>
  )
}
