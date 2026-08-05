import { redirect } from 'next/navigation';

type Props = { params: Promise<{ customerId: string }> };

export default async function LegacyReceivableCustomerRedirect({ params }: Props) {
  const { customerId } = await params;
  redirect(`/cuentas/clients/${customerId}`);
}
