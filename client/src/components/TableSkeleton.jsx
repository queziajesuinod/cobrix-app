import React from 'react'
import { TableRow, TableCell, Skeleton } from '@mui/material'

/** Linhas de esqueleto para estado de carregamento de tabelas. */
export default function TableSkeleton({ rows = 6, columns = 4 }) {
  return Array.from({ length: rows }).map((_, r) => (
    <TableRow key={`sk-${r}`}>
      {Array.from({ length: columns }).map((_, c) => (
        <TableCell key={`sk-${r}-${c}`}>
          <Skeleton variant="text" width={c === 0 ? 24 : `${60 + ((r + c) % 3) * 15}%`} />
        </TableCell>
      ))}
    </TableRow>
  ))
}
