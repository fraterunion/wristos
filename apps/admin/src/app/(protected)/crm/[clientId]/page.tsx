'use client';

import { use } from 'react';
import CrmWorkspace from '../crm-workspace';

type CrmClientPageProps = {
  params: Promise<{ clientId: string }>;
};

export default function CrmClientPage({ params }: CrmClientPageProps) {
  const { clientId } = use(params);
  return <CrmWorkspace initialClientId={clientId} />;
}
