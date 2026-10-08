import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
  createB2SignedUrl,
  deleteB2Object,
  getB2Object,
  getB2Target,
  inspectB2Video,
  type B2StorageEnvironment,
} from "./lib/b2Storage";

interface Env extends B2StorageEnvironment {
  ASSETS: { fetch(request: Request): Promise<Response> };
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function attachmentDisposition(fileName: string): string {
  const safeName = fileName.replace(/[\r\n]/g, "").slice(0, 255) || "download";
  const fallback = safeName.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(safeName).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

async function requireUserId(request: Request, env: Env): Promise<string | Response> {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match) return json({ error: "A valid customer session is required." }, 401);

  const supabaseUrl = env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const anonKey = env.SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !anonKey) {
    return json({ error: "Customer session validation is not configured." }, 503);
  }

  let response: Response;
  try {
    response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${match[1]}` },
    });
  } catch {
    return json({ error: "Customer session validation is unavailable." }, 503);
  }
  if (!response.ok) {
    return json({ error: "The customer session is invalid or expired." }, 401);
  }

  const user = (await response.json()) as { id?: unknown };
  if (typeof user.id !== "string" || !UUID_PATTERN.test(user.id)) {
    return json({ error: "The customer session is invalid." }, 401);
  }
  return user.id;
}

function storageError(error: unknown): Response {
  const record = error as { name?: unknown; $metadata?: { httpStatusCode?: number } };
  const status = record.$metadata?.httpStatusCode;
  const name = typeof record.name === "string" ? record.name : "";
  const code =
    status === 404 || name === "NoSuchKey" || name === "NotFound"
      ? 404
      : status === 416
        ? 416
        : 502;
  return json(
    {
      error:
        code === 404
          ? "Stored object was not found."
          : code === 416
            ? "The requested byte range is not available."
            : "B2 storage request failed.",
    },
    code,
  );
}

async function removeAllVersions(key: string, env: Env): Promise<void> {
  const target = await getB2Target(env);
  let keyMarker: string | undefined;
  let versionIdMarker: string | undefined;
  for (;;) {
    const page = await target.client.send(
      new ListObjectVersionsCommand({
        Bucket: target.bucketName,
        Prefix: key,
        ...(keyMarker ? { KeyMarker: keyMarker } : {}),
        ...(versionIdMarker ? { VersionIdMarker: versionIdMarker } : {}),
      }),
    );
    const versions = [...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])].filter(
      (entry) => entry.Key === key && typeof entry.VersionId === "string",
    );
    if (versions.length) {
      const result = await target.client.send(
        new DeleteObjectsCommand({
          Bucket: target.bucketName,
          Delete: {
            Objects: versions.map((entry) => ({ Key: key, VersionId: entry.VersionId })),
            Quiet: false,
          },
        }),
      );
      if (result.Errors?.length) {
        throw new Error(`B2 could not permanently delete ${result.Errors.length} object version(s).`);
      }
    }
    if (!page.IsTruncated) return;
    const nextKeyMarker = page.NextKeyMarker;
    const nextVersionIdMarker = page.NextVersionIdMarker;
    if (!nextKeyMarker || (nextKeyMarker === keyMarker && nextVersionIdMarker === versionIdMarker)) {
      throw new Error("B2 returned an invalid object-version pagination marker.");
    }
    keyMarker = nextKeyMarker;
    versionIdMarker = nextVersionIdMarker;
  }
}

async function routeB2(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/b2\/objects\/([^/]+)(?:\/(signed-url|inspect))?\/?$/);
  if (!match) return json({ error: "Not found." }, 404);

  let fileId: string;
  try {
    fileId = decodeURIComponent(match[1]);
  } catch {
    return json({ error: "A valid file identifier is required." }, 400);
  }
  if (!UUID_PATTERN.test(fileId)) {
    return json({ error: "A valid file identifier is required." }, 400);
  }

  const owner = await requireUserId(request, env);
  if (owner instanceof Response) return owner;
  const key = `${owner}/${fileId}`;
  const suffix = match[2];

  try {
    if (suffix === "signed-url" && request.method === "GET") {
      const rawExpiry = url.searchParams.get("expiresIn");
      const expiresIn = rawExpiry === null ? 900 : Number(rawExpiry);
      const downloadName = url.searchParams.get("download") ?? undefined;
      if (!Number.isInteger(expiresIn) || expiresIn < 60 || expiresIn > 3600) {
        return json({ error: "Invalid signed URL request." }, 400);
      }
      const signedUrl = await createB2SignedUrl({ key, expiresIn, downloadName }, env);
      return json({ signedUrl, expiresIn });
    }

    if (suffix === "inspect" && request.method === "GET") {
      return json(await inspectB2Video(key, fileId, env));
    }

    if (suffix) return json({ error: "Not found." }, 404);

    if (request.method === "POST") {
      if (!request.body) return json({ error: "Upload body is required." }, 400);
      const rawLength = request.headers.get("content-length");
      const contentLength = rawLength === null ? undefined : Number(rawLength);
      if (contentLength !== undefined && (!Number.isSafeInteger(contentLength) || contentLength < 0)) {
        return json({ error: "Invalid upload length." }, 400);
      }
      const rawMimeType = (request.headers.get("x-file-content-type") ?? "")
        .split(";", 1)[0]
        .trim()
        .toLowerCase();
      const mimeType = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(rawMimeType)
        ? rawMimeType
        : "application/octet-stream";
      const target = await getB2Target(env);
      await target.client.send(
        new PutObjectCommand({
          Bucket: target.bucketName,
          Key: key,
          Body: request.body as never,
          ContentType: mimeType,
          ...(contentLength === undefined ? {} : { ContentLength: contentLength }),
        }),
      );
      const head = await target.client.send(
        new HeadObjectCommand({ Bucket: target.bucketName, Key: key }),
      );
      const sizeBytes = head.ContentLength;
      if (sizeBytes === undefined || !Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
        await deleteB2Object(key);
        return json({ error: "B2 did not return a valid object size after upload." }, 502);
      }
      if (contentLength !== undefined && sizeBytes !== contentLength) {
        await deleteB2Object(key);
        return json({ error: "The uploaded B2 object size did not match the request." }, 502);
      }
      return json(
        {
          storageKey: key,
          bucketId: target.bucketMarker,
          sizeBytes,
          mimeType: head.ContentType || mimeType,
        },
        201,
      );
    }

    if (request.method === "GET") {
      const object = await getB2Object({
        key,
        range: request.headers.get("range") ?? undefined,
      }, env);
      const headers = new Headers({
        "Accept-Ranges": "bytes",
        "Content-Type": object.ContentType || "application/octet-stream",
      });
      if (object.ContentLength !== undefined) {
        headers.set("Content-Length", String(object.ContentLength));
      }
      if (object.ContentRange) headers.set("Content-Range", object.ContentRange);
      if (object.ETag) headers.set("ETag", object.ETag);
      if (object.LastModified) headers.set("Last-Modified", object.LastModified.toUTCString());
      const downloadName = url.searchParams.get("download");
      if (downloadName) headers.set("Content-Disposition", attachmentDisposition(downloadName));
      const body = object.Body
        ? (object.Body as { transformToWebStream(): ReadableStream }).transformToWebStream()
        : null;
      return new Response(body, {
        status: object.$metadata.httpStatusCode ?? 200,
        headers,
      });
    }

    if (request.method === "DELETE") {
      await removeAllVersions(key, env);
      return new Response(null, { status: 204 });
    }

    return json({ error: "Method not allowed." }, 405);
  } catch (error) {
    return storageError(error);
  }
}

async function fetchAssets(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return env.ASSETS.fetch(request);

  const headers = new Headers(request.headers);
  headers.delete("accept-encoding");
  headers.delete("if-none-match");
  headers.delete("if-modified-since");

  const assetResponse = await env.ASSETS.fetch(new Request(request, { headers }));
  if (!assetResponse.ok || !assetResponse.headers.get("content-type")?.toLowerCase().includes("text/html")) {
    return assetResponse;
  }

  const supabaseUrl = env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const anonKey = env.SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !anonKey) {
    return json({ error: "Customer authentication is not configured." }, 503);
  }

  const html = await assetResponse.text();
  const config = JSON.stringify({ url: supabaseUrl, anonKey }).replace(/</g, "\\u003c");
  const configuredHtml = html.replace(
    /<\/head>/i,
    `<script>window.__AM0SP_SUPABASE_CONFIG__=${config};</script></head>`,
  );
  if (configuredHtml === html) {
    return json({ error: "Customer app configuration could not be loaded." }, 502);
  }

  const responseHeaders = new Headers(assetResponse.headers);
  responseHeaders.delete("content-length");
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("etag");
  responseHeaders.set("cache-control", "no-store");
  return new Response(configuredHtml, {
    status: assetResponse.status,
    statusText: assetResponse.statusText,
    headers: responseHeaders,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/api/healthz") return json({ status: "ok" });
    if (pathname.startsWith("/api/b2/")) return routeB2(request, env);
    if (pathname.startsWith("/api/")) return json({ error: "Not found." }, 404);
    return fetchAssets(request, env);
  },
};
