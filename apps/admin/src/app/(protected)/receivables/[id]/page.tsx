import { redirect } from 'next/navigation';

/**
 * Legacy receivable detail IDs are not AccountEntry IDs.
 * Production has zero Receivable rows — send users to the canonical workspace.
 */
export default function LegacyReceivableDetailRedirect() {
  redirect('/cuentas?type=RECEIVABLE');
}
