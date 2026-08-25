import type { Request, Response } from 'express';
import type { Cradle } from '../container';
import { requireUser } from '../middleware/authenticate';
import type {
  CloseCommissionPeriodBody,
  CommissionPeriodIdParams,
  CommissionRuleIdParams,
  CreateCommissionRuleBody,
  ListCommissionAdvancesQuery,
  ListCommissionEntriesQuery,
  ListCommissionPeriodsQuery,
  ListCommissionRulesQuery,
  PayCommissionPeriodBody,
  RecordCommissionAdvanceBody,
  UpdateCommissionRuleBody,
} from '../schemas/commissions.schemas';
import type {
  CommissionsService,
  PagedAdvances,
  PagedEntries,
  PagedPeriods,
} from '../services/commissions.service';

function paged(result: PagedEntries | PagedPeriods | PagedAdvances) {
  return {
    data: result.items,
    meta: { total: result.total, limit: result.limit, offset: result.offset },
  };
}

export class CommissionsController {
  private readonly commissionsService: CommissionsService;

  constructor({ commissionsService }: Cradle) {
    this.commissionsService = commissionsService;
  }

  createRule = async (req: Request, res: Response): Promise<void> => {
    const body = req.validated.body as CreateCommissionRuleBody;

    res.status(201).json({ data: await this.commissionsService.createRule(body) });
  };

  listRules = async (req: Request, res: Response): Promise<void> => {
    const query = req.validated.query as ListCommissionRulesQuery;

    res.json({ data: await this.commissionsService.listRules(query, requireUser(req)) });
  };

  updateRule = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as CommissionRuleIdParams;
    const body = req.validated.body as UpdateCommissionRuleBody;

    res.json({ data: await this.commissionsService.updateRule(id, body) });
  };

  listEntries = async (req: Request, res: Response): Promise<void> => {
    const query = req.validated.query as ListCommissionEntriesQuery;

    res.json(paged(await this.commissionsService.listEntries(query, requireUser(req))));
  };

  recordAdvance = async (req: Request, res: Response): Promise<void> => {
    const body = req.validated.body as RecordCommissionAdvanceBody;

    res
      .status(201)
      .json({ data: await this.commissionsService.recordAdvance(body, requireUser(req)) });
  };

  listAdvances = async (req: Request, res: Response): Promise<void> => {
    const query = req.validated.query as ListCommissionAdvancesQuery;

    res.json(paged(await this.commissionsService.listAdvances(query, requireUser(req))));
  };

  closePeriod = async (req: Request, res: Response): Promise<void> => {
    const body = req.validated.body as CloseCommissionPeriodBody;

    res
      .status(201)
      .json({ data: await this.commissionsService.closePeriod(body, requireUser(req)) });
  };

  listPeriods = async (req: Request, res: Response): Promise<void> => {
    const query = req.validated.query as ListCommissionPeriodsQuery;

    res.json(paged(await this.commissionsService.listPeriods(query, requireUser(req))));
  };

  getStatement = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as CommissionPeriodIdParams;

    res.json({ data: await this.commissionsService.getStatement(id, requireUser(req)) });
  };

  payPeriod = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as CommissionPeriodIdParams;
    const body = req.validated.body as PayCommissionPeriodBody;

    res.json({ data: await this.commissionsService.payPeriod(id, body, requireUser(req)) });
  };
}
