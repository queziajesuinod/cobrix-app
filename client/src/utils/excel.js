function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function downloadExcel(filename, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  const headers = Object.keys(rows[0] || {});
  const headerHtml = headers.map((key) => `<th>${escapeHtml(key)}</th>`).join('');
  const bodyHtml = rows
    .map((row) => {
      const cells = headers.map((key) => `<td>${escapeHtml(row[key])}</td>`).join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  const html = [
    '<html xmlns:o="urn:schemas-microsoft-com:office:office"',
    ' xmlns:x="urn:schemas-microsoft-com:office:excel"',
    ' xmlns="http://www.w3.org/TR/REC-html40">',
    '<head><meta charset="UTF-8" /></head>',
    '<body>',
    '<table border="1">',
    `<thead><tr>${headerHtml}</tr></thead>`,
    `<tbody>${bodyHtml}</tbody>`,
    '</table>',
    '</body>',
    '</html>',
  ].join('');

  const blob = new Blob(['\uFEFF', html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
