import { whatsappNumber } from './config';

export function buildWhatsAppUrl(message: string): string {
  const text = encodeURIComponent(message);
  if (whatsappNumber) {
    return `https://wa.me/${whatsappNumber}?text=${text}`;
  }
  return `https://api.whatsapp.com/send?text=${text}`;
}
