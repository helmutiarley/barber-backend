import type { Request, Response } from 'express';
import type { Cradle } from '../container';
import type {
  CreateShopBody,
  ShopIdParams,
  TlsCheckQuery,
  UpdateShopBody,
} from '../schemas/platform.schemas';
import type { PlatformService } from '../services/platform.service';

export class PlatformController {
  private readonly platformService: PlatformService;

  constructor({ platformService }: Cradle) {
    this.platformService = platformService;
  }

  list = async (_req: Request, res: Response): Promise<void> => {
    res.json({ data: await this.platformService.list() });
  };

  getById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as ShopIdParams;

    res.json({ data: await this.platformService.getById(id) });
  };

  create = async (req: Request, res: Response): Promise<void> => {
    const body = req.validated.body as CreateShopBody;

    res.status(201).json({ data: await this.platformService.create(body) });
  };

  update = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as ShopIdParams;
    const body = req.validated.body as UpdateShopBody;

    res.json({ data: await this.platformService.update(id, body) });
  };

  tlsCheck = async (req: Request, res: Response): Promise<void> => {
    const { domain } = req.validated.query as TlsCheckQuery;

    if (await this.platformService.isDomainServed(domain)) {
      res.status(200).send();
      return;
    }

    res.status(404).send();
  };
}
