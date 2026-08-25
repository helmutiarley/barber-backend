import type { Request, Response } from 'express';
import type { Cradle } from '../container';
import type {
  CreateServiceBody,
  ListServicesQuery,
  ServiceIdParams,
  UpdateServiceBody,
} from '../schemas/services.schemas';
import type { ServicesService } from '../services/services.service';

export class ServicesController {
  private readonly servicesService: ServicesService;

  constructor({ servicesService }: Cradle) {
    this.servicesService = servicesService;
  }

  create = async (req: Request, res: Response): Promise<void> => {
    const body = req.validated.body as CreateServiceBody;

    res.status(201).json({ data: await this.servicesService.create(body) });
  };

  list = async (req: Request, res: Response): Promise<void> => {
    const { includeInactive } = req.validated.query as ListServicesQuery;

    res.json({ data: await this.servicesService.list(includeInactive ?? false, req.user) });
  };

  getById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as ServiceIdParams;

    res.json({ data: await this.servicesService.getById(id) });
  };

  update = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as ServiceIdParams;
    const body = req.validated.body as UpdateServiceBody;

    res.json({ data: await this.servicesService.update(id, body) });
  };

  deactivate = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as ServiceIdParams;

    res.json({ data: await this.servicesService.deactivate(id) });
  };
}
