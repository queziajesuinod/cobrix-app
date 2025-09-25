export function formatDateOnly(val) {
  if (!val) return '-';
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    const [y,m,d] = val.split('-');
    return `${d}/${m}/${y}`;
    }
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Campo_Grande' })
           .format(new Date(val));
}
