import type { Request, Response } from 'express';
import type { Cradle } from '../container';
import { requireUser } from '../middleware/authenticate';
import type {
  ListProductSalesQuery,
  SaleIdParams,
  SellProductsBody,
  VoidSaleBody,
} from '../schemas/product-sales.schemas';
import type { PagedProductSales, ProductSalesService } from '../services/product-sales.service';

export class ProductSalesController {
  private readonly productSalesService: ProductSalesService;

  constructor({ productSalesService }: Cradle) {
    this.productSalesService = productSalesService;
  }

  sell = async (req: Request, res: Response): Promise<void> => {
    const body = req.validated.body as SellProductsBody;

    res.status(201).json({ data: await this.productSalesService.sell(body, requireUser(req)) });
  };

  list = async (req: Request, res: Response): Promise<void> => {
    const query = req.validated.query as ListProductSalesQuery;
    const result: PagedProductSales = await this.productSalesService.list(query);

    res.json({
      data: result.items,
      meta: { total: result.total, limit: result.limit, offset: result.offset },
    });
  };

  get = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as SaleIdParams;

    res.json({ data: await this.productSalesService.get(id) });
  };

  voidSale = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as SaleIdParams;
    const body = req.validated.body as VoidSaleBody;

    res.json({ data: await this.productSalesService.voidSale(id, body, requireUser(req)) });
  };
}
