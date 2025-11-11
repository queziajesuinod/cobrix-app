import React from 'react'
import { Grid, Card, CardContent, Typography } from '@mui/material'

function KCard({ label, value }) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="overline" color="text.secondary">{label}</Typography>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>{value}</Typography>
      </CardContent>
    </Card>
  )
}

export default function KpiCards({ k }) {
  return (
    <Grid container spacing={2}>
      <Grid item xs={6} md={3}><KCard label="Contratos ativos" value={k.contractsActive ?? 0} /></Grid>
      <Grid item xs={6} md={3}><KCard label="Contratos pagos" value={k.contractsPaid ?? 0} /></Grid>
      <Grid item xs={6} md={3}><KCard label="Contratos pendentes" value={k.contractsPending ?? 0} /></Grid>
    </Grid>
  )
}
