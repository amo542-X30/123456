import { Router, type IRouter } from "express";
import b2StorageRouter from "./b2Storage";
import healthRouter from "./health";

const router: IRouter = Router();

router.use(healthRouter);
router.use(b2StorageRouter);

export default router;
