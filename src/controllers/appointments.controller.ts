import type { Request, Response } from 'express';
import type { Cradle } from '../container';
import { requireUser } from '../middleware/authenticate';
import type {
  AgendaQuery,
  AppointmentIdParams,
  BarberIdParams,
  CancelAppointmentBody,
  CreateAppointmentBody,
  ListAppointmentsQuery,
  PageQuery,
  RescheduleAppointmentBody,
} from '../schemas/appointments.schemas';
import type { AppointmentsService, PagedAppointments } from '../services/appointments.service';

function paged(result: PagedAppointments) {
  return {
    data: result.items,
    meta: { total: result.total, limit: result.limit, offset: result.offset },
  };
}

export class AppointmentsController {
  private readonly appointmentsService: AppointmentsService;

  constructor({ appointmentsService }: Cradle) {
    this.appointmentsService = appointmentsService;
  }

  create = async (req: Request, res: Response): Promise<void> => {
    const body = req.validated.body as CreateAppointmentBody;
    const actor = requireUser(req);

    const appointment = await this.appointmentsService.createAppointment(
      {
        clientId: body.clientId,
        walkIn: body.walkIn,
        barberId: body.barberId,
        serviceId: body.serviceId,
        startsAt: body.startsAt,
        notes: body.notes ?? null,
        force: body.force,
      },
      actor,
    );

    res.status(201).json({ data: appointment });
  };

  getById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as AppointmentIdParams;

    res.json({ data: await this.appointmentsService.getAppointment(id, requireUser(req)) });
  };

  list = async (req: Request, res: Response): Promise<void> => {
    const query = req.validated.query as ListAppointmentsQuery;

    res.json(paged(await this.appointmentsService.list(query)));
  };

  listMine = async (req: Request, res: Response): Promise<void> => {
    const query = req.validated.query as PageQuery;

    res.json(paged(await this.appointmentsService.listOwn(requireUser(req), query)));
  };

  agenda = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as BarberIdParams;
    const { date } = req.validated.query as AgendaQuery;

    res.json({
      data: await this.appointmentsService.listBarberDay(id, date, requireUser(req)),
    });
  };

  reschedule = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as AppointmentIdParams;
    const body = req.validated.body as RescheduleAppointmentBody;

    const appointment = await this.appointmentsService.reschedule(
      id,
      { startsAt: body.startsAt, notes: body.notes, force: body.force },
      requireUser(req),
    );

    res.json({ data: appointment });
  };

  confirm = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as AppointmentIdParams;

    res.json({ data: await this.appointmentsService.confirm(id, requireUser(req)) });
  };

  complete = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as AppointmentIdParams;

    res.json({ data: await this.appointmentsService.complete(id, requireUser(req)) });
  };

  noShow = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as AppointmentIdParams;

    res.json({ data: await this.appointmentsService.markNoShow(id, requireUser(req)) });
  };

  cancel = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as AppointmentIdParams;
    const body = req.validated.body as CancelAppointmentBody;

    res.json({ data: await this.appointmentsService.cancel(id, body, requireUser(req)) });
  };
}
