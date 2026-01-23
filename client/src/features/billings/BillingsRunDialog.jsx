import React, { useState } from 'react'
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Stack, TextField, FormGroup, FormControlLabel, Checkbox } from '@mui/material'

export default function BillingsRunDialog({ open, onClose, onConfirm }) {
  // Usa data local (YYYY-MM-DD) para evitar shift de timezone no default
  const [date, setDate] = useState(() => new Date().toLocaleDateString('sv-SE'))
  const [flags, setFlags] = useState({
    generate: true,
    pre: true,
    due: true,
    late: true,
    includeWeekly: true,
    includeCustom: true,
  })
  const toggle = (k) => setFlags((s) => ({ ...s, [k]: !s[k] }))

  const submit = () => { onConfirm({ date, ...flags }) }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Executar rotina de cobranças</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <TextField
            label="Data de referência"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <FormGroup>
            <FormControlLabel control={<Checkbox checked={flags.generate} onChange={() => toggle('generate')} />} label="Gerar cobranças do dia" />
            <FormControlLabel control={<Checkbox checked={flags.includeWeekly} onChange={() => toggle('includeWeekly')} />} label="Incluir semanais" />
            <FormControlLabel control={<Checkbox checked={flags.includeCustom} onChange={() => toggle('includeCustom')} />} label="Incluir datas personalizadas" />
            <FormControlLabel control={<Checkbox checked={flags.pre} onChange={() => toggle('pre')} />} label="Enviar D−4 (pré-vencimento)" />
            <FormControlLabel control={<Checkbox checked={flags.due} onChange={() => toggle('due')} />} label="Enviar D0 (vence hoje)" />
            <FormControlLabel control={<Checkbox checked={flags.late} onChange={() => toggle('late')} />} label="Enviar D+3 (atraso)" />
          </FormGroup>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" onClick={submit}>Executar</Button>
      </DialogActions>
    </Dialog>
  )
}
