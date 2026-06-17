import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Client,
  StorefrontReservation,
  StorefrontReservationStatus,
  WatchStatus,
} from '@prisma/client';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service';

const DEFAULT_SUCCESS_URL = 'https://wristcaviar.fraterunion.com/storefront/success';
const DEFAULT_CANCEL_URL = 'https://wristcaviar.fraterunion.com/storefront/cancel';
const RESERVATION_HOLD_HOURS = 48;

export type ReservationCheckoutSessionParams = {
  reservationId: string;
  tenantId: string;
  tenantSlug: string;
  watchId: string;
  publicSlug: string;
  customerEmail: string;
  watchLabel: string;
  amountMxn: number;
};

@Injectable()
export class StripeService implements OnModuleInit {
  private readonly logger = new Logger(StripeService.name);
  private stripe!: Stripe;
  private webhookSecret!: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    if (!secretKey) {
      this.logger.warn('STRIPE_SECRET_KEY is not set — Stripe checkout will fail at runtime');
    } else {
      this.stripe = new Stripe(secretKey);
    }

    const webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!webhookSecret) {
      this.logger.warn('STRIPE_WEBHOOK_SECRET is not set — webhook verification will fail');
    } else {
      this.webhookSecret = webhookSecret;
    }

    const successUrl = this.configService.get<string>('STOREFRONT_SUCCESS_URL');
    const cancelUrl = this.configService.get<string>('STOREFRONT_CANCEL_URL');
    if (!successUrl) {
      this.logger.warn(
        `STOREFRONT_SUCCESS_URL not set — using default: ${DEFAULT_SUCCESS_URL}`,
      );
    }
    if (!cancelUrl) {
      this.logger.warn(
        `STOREFRONT_CANCEL_URL not set — using default: ${DEFAULT_CANCEL_URL}`,
      );
    }
  }

  getSuccessUrl(): string {
    return this.configService.get<string>('STOREFRONT_SUCCESS_URL') ?? DEFAULT_SUCCESS_URL;
  }

  getCancelUrl(): string {
    return this.configService.get<string>('STOREFRONT_CANCEL_URL') ?? DEFAULT_CANCEL_URL;
  }

  async createReservationCheckoutSession(
    params: ReservationCheckoutSessionParams,
  ): Promise<Stripe.Checkout.Session> {
    this.ensureStripeConfigured();

    const unitAmount = Math.round(params.amountMxn * 100);
    if (unitAmount <= 0) {
      throw new BadRequestException('Reservation amount must be greater than 0');
    }

    const successUrl = `${this.getSuccessUrl()}?session_id={CHECKOUT_SESSION_ID}`;

    return this.stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: params.customerEmail,
      success_url: successUrl,
      cancel_url: this.getCancelUrl(),
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'mxn',
            unit_amount: unitAmount,
            product_data: {
              name: `${params.watchLabel} — apartado`,
              description: `Apartado para ${params.publicSlug}`,
            },
          },
        },
      ],
      metadata: {
        tenantId: params.tenantId,
        watchId: params.watchId,
        reservationId: params.reservationId,
        tenantSlug: params.tenantSlug,
        publicSlug: params.publicSlug,
        source: 'storefront_reservation',
      },
    });
  }

  async expireCheckoutSession(sessionId: string): Promise<void> {
    if (!this.stripe) return;
    try {
      await this.stripe.checkout.sessions.expire(sessionId);
    } catch (error) {
      this.logger.warn(`Failed to expire Stripe session ${sessionId}`, error);
    }
  }

  constructWebhookEvent(rawBody: Buffer, signature: string | undefined): Stripe.Event {
    this.ensureStripeConfigured();
    if (!this.webhookSecret) {
      throw new BadRequestException('Stripe webhook is not configured');
    }
    if (!signature) {
      throw new BadRequestException('Missing Stripe-Signature header');
    }

    return this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
  }

  async handleWebhookEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutSessionCompleted(event);
        return;
      case 'checkout.session.expired':
        await this.handleCheckoutSessionExpired(event);
        return;
      default:
        return;
    }
  }

  private async handleCheckoutSessionCompleted(event: Stripe.Event): Promise<void> {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.metadata?.source !== 'storefront_reservation') {
      return;
    }

    const reservation = await this.findReservationForSession(session);
    if (!reservation) {
      this.logger.warn(
        `checkout.session.completed: no reservation for session ${session.id}`,
      );
      return;
    }

    if (reservation.status === StorefrontReservationStatus.PAID) {
      return;
    }

    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id ?? null;

    const reservationExpiresAt = new Date(
      Date.now() + RESERVATION_HOLD_HOURS * 60 * 60 * 1000,
    );

    const client = await this.findOrCreateClient(reservation);

    await this.prisma.$transaction(async (tx) => {
      await tx.storefrontReservation.update({
        where: { id: reservation.id },
        data: {
          status: StorefrontReservationStatus.PAID,
          stripePaymentIntentId: paymentIntentId,
          webhookEventId: event.id,
          reservationExpiresAt,
          clientId: client.id,
        },
      });

      const watch = await tx.watch.findFirst({
        where: { id: reservation.watchId, tenantId: reservation.tenantId, deletedAt: null },
        select: { id: true, status: true },
      });

      if (!watch) {
        this.logger.warn(
          `checkout.session.completed: watch ${reservation.watchId} not found for reservation ${reservation.id}`,
        );
        return;
      }

      if (watch.status === WatchStatus.AVAILABLE) {
        await tx.watch.update({
          where: { id: watch.id },
          data: {
            status: WatchStatus.RESERVED,
            isPublished: false,
          },
        });
      } else {
        this.logger.warn(
          `checkout.session.completed: watch ${watch.id} is ${watch.status}, not reserving`,
        );
      }
    });
  }

  private async handleCheckoutSessionExpired(event: Stripe.Event): Promise<void> {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.metadata?.source !== 'storefront_reservation') {
      return;
    }

    const reservation = await this.findReservationForSession(session);
    if (!reservation) {
      this.logger.warn(
        `checkout.session.expired: no reservation for session ${session.id}`,
      );
      return;
    }

    if (reservation.status !== StorefrontReservationStatus.PENDING) {
      return;
    }

    await this.prisma.storefrontReservation.update({
      where: { id: reservation.id },
      data: {
        status: StorefrontReservationStatus.CANCELLED,
        expiredAt: new Date(),
      },
    });
  }

  private async findReservationForSession(
    session: Stripe.Checkout.Session,
  ): Promise<StorefrontReservation | null> {
    const bySessionId = await this.prisma.storefrontReservation.findFirst({
      where: { stripeCheckoutSessionId: session.id, deletedAt: null },
    });
    if (bySessionId) return bySessionId;

    const reservationId = session.metadata?.reservationId;
    if (!reservationId) return null;

    return this.prisma.storefrontReservation.findFirst({
      where: { id: reservationId, deletedAt: null },
    });
  }

  private async findOrCreateClient(reservation: StorefrontReservation): Promise<Client> {
    const email = reservation.customerEmail.trim().toLowerCase();

    const existing = await this.prisma.client.findFirst({
      where: {
        tenantId: reservation.tenantId,
        deletedAt: null,
        email: { equals: email, mode: 'insensitive' },
      },
    });
    if (existing) return existing;

    return this.prisma.client.create({
      data: {
        tenant: { connect: { id: reservation.tenantId } },
        name: reservation.customerName,
        email: reservation.customerEmail,
        phone: reservation.customerPhone,
      },
    });
  }

  private ensureStripeConfigured(): void {
    if (!this.stripe) {
      throw new BadRequestException('Stripe is not configured on this server');
    }
  }
}
