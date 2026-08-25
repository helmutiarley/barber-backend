import type { Request, Response } from 'express';
import type { Cradle } from '../container';
import { requireUser } from '../middleware/authenticate';
import type {
  AvailabilityQuery,
  BarberIdParams,
  BlockIdParams,
  CreateBarberBody,
  CreateBlockBody,
  ReplaceScheduleBody,
  UpdateBarberBody,
} from '../schemas/barbers.schemas';
import type { AvailabilityService } from '../services/availability.service';
import type { BarbersService } from '../services/barbers.service';

export class BarbersController {
  private readonly barbersService: BarbersService;
  private readonly availabilityService: AvailabilityService;

  constructor({ barbersService, availabilityService }: Cradle) {
    this.barbersService = barbersService;
    this.availabilityService = availabilityService;
  }

  create = async (req: Request, res: Response): Promise<void> => {
    const body = req.validated.body as CreateBarberBody;

    res.status(201).json({ data: await this.barbersService.create(body) });
  };

  list = async (_req: Request, res: Response): Promise<void> => {
    res.json({ data: await this.barbersService.listPublic() });
  };

  getById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as BarberIdParams;

    res.json({ data: await this.barbersService.getPublicById(id) });
  };

  update = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as BarberIdParams;
    const body = req.validated.body as UpdateBarberBody;

    res.json({ data: await this.barbersService.update(id, body, requireUser(req)) });
  };

  deactivate = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as BarberIdParams;

    res.json({ data: await this.barbersService.deactivate(id) });
  };

  getSchedule = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as BarberIdParams;

    res.json({ data: await this.barbersService.getSchedule(id) });
  };

  replaceSchedule = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as BarberIdParams;
    const { days } = req.validated.body as ReplaceScheduleBody;

    res.json({ data: await this.barbersService.replaceSchedule(id, days, requireUser(req)) });
  };

  createBlock = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as BarberIdParams;
    const body = req.validated.body as CreateBlockBody;

    res
      .status(201)
      .json({ data: await this.barbersService.createBlock(id, body, requireUser(req)) });
  };

  deleteBlock = async (req: Request, res: Response): Promise<void> => {
    const { id, blockId } = req.validated.params as BlockIdParams;

    await this.barbersService.deleteBlock(id, blockId, requireUser(req));
    res.status(204).send();
  };

  availability = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as BarberIdParams;
    const query = req.validated.query as AvailabilityQuery;

    res.json({ data: await this.availabilityService.getDay({ barberId: id, ...query }) });
  };
}
