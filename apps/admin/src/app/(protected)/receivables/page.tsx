import { redirect } from 'next/navigation';

/** Legacy receivables list → canonical Cuentas por cobrar. */
export default function LegacyReceivablesRedirect() {
  redirect('/cuentas?type=RECEIVABLE');
}
