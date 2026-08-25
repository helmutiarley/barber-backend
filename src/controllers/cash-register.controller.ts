import type { Request, Response } from 'express';
import type { Cradle } from '../container';
import { requireUser } from '../middleware/authenticate';
import type {
  CloseSessionBody,
  CreateMovementBody,
  ListSessionsQuery,
  OpenSessionBody,
  SessionIdParams,
} from '../schemas/cash-register.schemas';
import type { CashRegisterService, PagedSessions } from '../services/cash-register.service';

function paged(result: PagedSessions) {
  return {
    data: result.items,
    meta: { total: result.total, limit: result.limit, offset: result.offset },
  };
}

export class CashRegisterController {
  private readonly cashRegisterService: CashRegisterService;

  constructor({ cashRegisterService }: Cradle) {
    this.cashRegisterService = cashRegisterService;
  }

  open = async (req: Request, res: Response): Promise<void> => {
    const body = req.validated.body as OpenSessionBody;

    res.status(201).json({ data: await this.cashRegisterService.open(body, requireUser(req)) });
  };

  close = async (req: Request, res: Response): Promise<void> => {
    const body = req.validated.body as CloseSessionBody;

    res.json({ data: await this.cashRegisterService.close(body, requireUser(req)) });
  };

  current = async (_req: Request, res: Response): Promise<void> => {
    res.json({ data: await this.cashRegisterService.current() });
  };

  createMovement = async (req: Request, res: Response): Promise<void> => {
    const body = req.validated.body as CreateMovementBody;

    const movement = await this.cashRegisterService.recordManualMovement(body, requireUser(req));

    res.status(201).json({ data: movement });
  };

  listSessions = async (req: Request, res: Response): Promise<void> => {
    const query = req.validated.query as ListSessionsQuery;

    res.json(paged(await this.cashRegisterService.listSessions(query, query)));
  };

  getSession = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as SessionIdParams;

    res.json({ data: await this.cashRegisterService.getSession(id) });
  };
}
