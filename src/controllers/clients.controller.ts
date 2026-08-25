import type { Request, Response } from 'express';
import type { Cradle } from '../container';
import { requireUser } from '../middleware/authenticate';
import type { PageQuery } from '../schemas/appointments.schemas';
import type {
  ClientIdParams,
  ListClientsQuery,
  UpdateClientBody,
  UpdateOwnClientBody,
} from '../schemas/clients.schemas';
import type { PagedAppointments } from '../services/appointments.service';
import type { ClientsService, PagedClients } from '../services/clients.service';

function paged(result: PagedClients | PagedAppointments) {
  return {
    data: result.items,
    meta: { total: result.total, limit: result.limit, offset: result.offset },
  };
}

export class ClientsController {
  private readonly clientsService: ClientsService;

  constructor({ clientsService }: Cradle) {
    this.clientsService = clientsService;
  }

  list = async (req: Request, res: Response): Promise<void> => {
    const query = req.validated.query as ListClientsQuery;

    res.json(paged(await this.clientsService.list(query)));
  };

  getById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as ClientIdParams;

    res.json({ data: await this.clientsService.get(id, requireUser(req)) });
  };

  history = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as ClientIdParams;
    const query = req.validated.query as PageQuery;

    res.json(paged(await this.clientsService.getHistory(id, requireUser(req), query)));
  };

  update = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as ClientIdParams;
    const body = req.validated.body as UpdateClientBody;

    res.json({ data: await this.clientsService.updateProfile(id, body, requireUser(req)) });
  };

  getMine = async (req: Request, res: Response): Promise<void> => {
    res.json({ data: await this.clientsService.getOwn(requireUser(req).id) });
  };

  updateMine = async (req: Request, res: Response): Promise<void> => {
    const body = req.validated.body as UpdateOwnClientBody;

    res.json({ data: await this.clientsService.updateOwn(requireUser(req).id, body) });
  };
}
