import type { Request, Response } from 'express';
import type { Cradle } from '../container';
import { requireUser } from '../middleware/authenticate';
import type {
  AdjustStockBody,
  CreateProductBody,
  ListProductsQuery,
  ListStockAdjustmentsQuery,
  ProductIdParams,
  UpdateProductBody,
} from '../schemas/products.schemas';
import type {
  PagedProducts,
  PagedStockAdjustments,
  ProductsService,
} from '../services/products.service';

function paged(result: PagedProducts | PagedStockAdjustments) {
  return {
    data: result.items,
    meta: { total: result.total, limit: result.limit, offset: result.offset },
  };
}

export class ProductsController {
  private readonly productsService: ProductsService;

  constructor({ productsService }: Cradle) {
    this.productsService = productsService;
  }

  create = async (req: Request, res: Response): Promise<void> => {
    const body = req.validated.body as CreateProductBody;

    res.status(201).json({ data: await this.productsService.create(body, requireUser(req)) });
  };

  list = async (req: Request, res: Response): Promise<void> => {
    const query = req.validated.query as ListProductsQuery;

    res.json(paged(await this.productsService.list(query)));
  };

  get = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as ProductIdParams;

    res.json({ data: await this.productsService.get(id) });
  };

  update = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as ProductIdParams;
    const body = req.validated.body as UpdateProductBody;

    res.json({ data: await this.productsService.update(id, body) });
  };

  adjustStock = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as ProductIdParams;
    const body = req.validated.body as AdjustStockBody;

    res
      .status(201)
      .json({ data: await this.productsService.adjustStock(id, body, requireUser(req)) });
  };

  listAdjustments = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as ProductIdParams;
    const query = req.validated.query as ListStockAdjustmentsQuery;

    res.json(paged(await this.productsService.listAdjustments(id, query)));
  };

  deactivate = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as ProductIdParams;

    res.json({ data: await this.productsService.deactivate(id) });
  };
}
