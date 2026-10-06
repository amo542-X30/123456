import { Router, type IRouter, type Request, type Response } from "express";
import {
  DeleteB2ObjectParams,
  GetB2ObjectHeader,
  GetB2ObjectParams,
  GetB2ObjectQueryParams,
  GetB2SignedUrlParams,
  GetB2SignedUrlQueryParams,
  GetB2SignedUrlResponse,
  InspectB2ObjectParams,
  InspectB2ObjectResponse,
  UploadB2ObjectParams,
  UploadB2ObjectResponse,
} from "@workspace/api-zod";
import {
  createB2SignedUrl,
  deleteB2Object,
  getB2Object,
  inspectB2Video,
  uploadB2Object,
} from "../lib/b2Storage";

const router: IRouter = Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function requireUserId(req: Request, res: Response): Promise<string | null> {
  const authorization = req.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    res.status(401).json({ error: "A valid customer session is required." });
    return null;
  }

  const supabaseUrl = (
    process.env.VITE_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    ""
  ).trim().replace(/\/+$/, "");
  const anonKey = (
    process.env.VITE_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    ""
  ).trim();
  if (!supabaseUrl || !anonKey) {
    res.status(503).json({ error: "Customer session validation is not configured." });
    return null;
  }

  let authResponse: globalThis.Response;
  try {
    authResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${match[1]}`,
      },
      cache: "no-store",
    });
  } catch {
    req.log.warn("Supabase session validation is unavailable for B2 storage.");
    res.status(503).json({ error: "Customer session validation is unavailable." });
    return null;
  }

  if (!authResponse.ok) {
    res.status(401).json({ error: "The customer session is invalid or expired." });
    return null;
  }

  const user = (await authResponse.json()) as { id?: unknown };
  if (typeof user.id !== "string" || !UUID_PATTERN.test(user.id)) {
    res.status(401).json({ error: "The customer session is invalid." });
    return null;
  }
  return user.id;
}

function attachmentDisposition(fileName: string): string {
  const safeName = fileName.replace(/[\r\n]/g, "").slice(0, 255) || "download";
  const fallback = safeName.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(safeName).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function handleStorageError(req: Request, res: Response, operation: string, error: unknown): void {
  if (res.headersSent || res.destroyed) return;

  const errorRecord = error as {
    name?: unknown;
    $metadata?: { httpStatusCode?: number };
  };
  const status = errorRecord.$metadata?.httpStatusCode;
  const errorName = typeof errorRecord.name === "string" ? errorRecord.name : "UnknownError";
  const responseStatus =
    status === 404 || errorName === "NoSuchKey" || errorName === "NotFound"
      ? 404
      : status === 416
        ? 416
        : 502;

  req.log.error({ operation, errorName, status: responseStatus }, "B2 storage request failed.");
  res.status(responseStatus).json({
    error:
      responseStatus === 404
        ? "Stored object was not found."
        : responseStatus === 416
          ? "The requested byte range is not available."
          : "B2 storage request failed.",
  });
}

router.post("/b2/objects/:fileId", async (req, res): Promise<void> => {
  const params = UploadB2ObjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "A valid file identifier is required." });
    return;
  }

  const userId = await requireUserId(req, res);
  if (!userId) return;

  const rawLength = req.get("content-length");
  const contentLength = rawLength === undefined ? undefined : Number(rawLength);
  if (
    contentLength !== undefined &&
    (!Number.isSafeInteger(contentLength) || contentLength < 0)
  ) {
    res.status(400).json({ error: "Invalid upload length." });
    return;
  }

  const rawMimeType = (req.get("x-file-content-type") ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  const mimeType = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(rawMimeType)
    ? rawMimeType
    : "application/octet-stream";
  try {
    const { bucketMarker, sizeBytes, mimeType: storedMimeType } = await uploadB2Object({
      key: `${userId}/${params.data.fileId}`,
      body: req,
      contentType: mimeType,
      contentLength,
    });

    res.status(201).json(
      UploadB2ObjectResponse.parse({
        storageKey: `${userId}/${params.data.fileId}`,
        bucketId: bucketMarker,
        sizeBytes,
        mimeType: storedMimeType,
      }),
    );
  } catch (error) {
    handleStorageError(req, res, "upload", error);
  }
});

router.get("/b2/objects/:fileId/signed-url", async (req, res): Promise<void> => {
  const params = GetB2SignedUrlParams.safeParse(req.params);
  const query = GetB2SignedUrlQueryParams.safeParse(req.query);
  if (!params.success || !query.success) {
    res.status(400).json({ error: "Invalid signed URL request." });
    return;
  }

  const userId = await requireUserId(req, res);
  if (!userId) return;

  const expiresIn = query.data.expiresIn ?? 900;
  try {
    const signedUrl = await createB2SignedUrl({
      key: `${userId}/${params.data.fileId}`,
      expiresIn,
      downloadName: query.data.download,
    });
    res.json(GetB2SignedUrlResponse.parse({ signedUrl, expiresIn }));
  } catch (error) {
    handleStorageError(req, res, "sign", error);
  }
});

router.get("/b2/objects/:fileId/inspect", async (req, res): Promise<void> => {
  const params = InspectB2ObjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "A valid file identifier is required." });
    return;
  }

  const userId = await requireUserId(req, res);
  if (!userId) return;

  try {
    const result = await inspectB2Video(
      `${userId}/${params.data.fileId}`,
      params.data.fileId,
    );
    res.json(InspectB2ObjectResponse.parse(result));
  } catch (error) {
    handleStorageError(req, res, "inspect", error);
  }
});

router.get("/b2/objects/:fileId", async (req, res): Promise<void> => {
  const params = GetB2ObjectParams.safeParse(req.params);
  const query = GetB2ObjectQueryParams.safeParse(req.query);
  const headers = GetB2ObjectHeader.safeParse({ Range: req.get("range") ?? undefined });
  if (!params.success || !query.success || !headers.success) {
    res.status(400).json({ error: "Invalid object request." });
    return;
  }

  const userId = await requireUserId(req, res);
  if (!userId) return;

  try {
    const object = await getB2Object({
      key: `${userId}/${params.data.fileId}`,
      range: headers.data.Range,
    });
    const status = object.$metadata.httpStatusCode ?? 200;
    res.status(status);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Type", object.ContentType || "application/octet-stream");
    if (object.ContentLength !== undefined) {
      res.setHeader("Content-Length", object.ContentLength);
    }
    if (object.ContentRange) res.setHeader("Content-Range", object.ContentRange);
    if (object.ETag) res.setHeader("ETag", object.ETag);
    if (object.LastModified) res.setHeader("Last-Modified", object.LastModified.toUTCString());
    if (query.data.download) {
      res.setHeader("Content-Disposition", attachmentDisposition(query.data.download));
    }

    if (!object.Body) {
      res.end();
      return;
    }

    const stream = object.Body as NodeJS.ReadableStream;
    stream.once("error", (error: unknown) => {
      const errorName =
        error && typeof error === "object" && "name" in error && typeof error.name === "string"
          ? error.name
          : "StreamError";
      req.log.error({ operation: "download", errorName }, "B2 object stream failed.");
      if (!res.headersSent) {
        res.status(502).json({ error: "B2 storage request failed." });
      } else {
        res.destroy();
      }
    });
    stream.pipe(res);
  } catch (error) {
    handleStorageError(req, res, "download", error);
  }
});

router.delete("/b2/objects/:fileId", async (req, res): Promise<void> => {
  const params = DeleteB2ObjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "A valid file identifier is required." });
    return;
  }

  const userId = await requireUserId(req, res);
  if (!userId) return;

  try {
    await deleteB2Object(`${userId}/${params.data.fileId}`);
    res.sendStatus(204);
  } catch (error) {
    handleStorageError(req, res, "delete", error);
  }
});

export default router;
