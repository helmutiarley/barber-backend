import type { Request, Response } from 'express';
import type { Cradle } from '../container';
import { requireUser } from '../middleware/authenticate';
import type { AppointmentIdParams } from '../schemas/appointments.schemas';
import type {
  ListPaymentsQuery,
  PaymentIdParams,
  RecordPaymentsBody,
  VoidPaymentBody,
} from '../schemas/payments.schemas';
import type { PagedPayments, PaymentsService } from '../services/payments.service';

function paged(result: PagedPayments) {
  return {
    data: result.items,
    meta: { total: result.total, limit: result.limit, offset: result.offset },
  };
}

export class PaymentsController {
  private readonly paymentsService: PaymentsService;

  constructor({ paymentsService }: Cradle) {
    this.paymentsService = paymentsService;
  }

  record = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as AppointmentIdParams;
    const body = req.validated.body as RecordPaymentsBody;

    const payments = await this.paymentsService.recordPayments(id, body.payments, requireUser(req));

    res.status(201).json({ data: payments });
  };

  listForAppointment = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as AppointmentIdParams;

    res.json({ data: await this.paymentsService.listForAppointment(id, requireUser(req)) });
  };

  list = async (req: Request, res: Response): Promise<void> => {
    const query = req.validated.query as ListPaymentsQuery;

    res.json(paged(await this.paymentsService.list(query)));
  };

  void = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as PaymentIdParams;
    const body = req.validated.body as VoidPaymentBody;

    res.json({ data: await this.paymentsService.voidPayment(id, body, requireUser(req)) });
  };
}
