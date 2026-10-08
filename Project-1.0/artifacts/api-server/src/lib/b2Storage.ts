import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  ListObjectVersionsCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "node:stream";

type B2Authorization = {
  apiInfo?: {
    storageApi?: {
      s3ApiUrl?: string;
    };
  };
  allowed?: {
    bucketName?: string | null;
  };
};

export type B2StorageEnvironment = {
  B2_APPLICATION_KEY_ID?: string;
  B2_APPLICATION_KEY?: string;
  B2_BUCKET_NAME?: string;
};

type B2Target = {
  client: S3Client;
  bucketName: string;
  bucketMarker: string;
};

export type B2VideoInspection = {
  fileId: string;
  fileName: string;
  mimeType: string;
  size: number;
  codec: Record<string, string>;
  moovBeforeMdat: boolean;
  moovFound: boolean;
  mdatFound: boolean;
  atoms: Record<string, unknown>;
  headerBytesRead: number;
};

let targetPromise: Promise<B2Target> | undefined;

async function initializeTarget(environment: B2StorageEnvironment): Promise<B2Target> {
  const applicationKeyId = environment.B2_APPLICATION_KEY_ID?.trim();
  const applicationKey = environment.B2_APPLICATION_KEY?.trim();
  if (!applicationKeyId || !applicationKey) {
    throw new Error("B2_APPLICATION_KEY_ID and B2_APPLICATION_KEY must be configured.");
  }

  const basicAuth = Buffer.from(`${applicationKeyId}:${applicationKey}`).toString("base64");
  const authorizationResponse = await fetch(
    "https://api.backblazeb2.com/b2api/v3/b2_authorize_account",
    { headers: { Authorization: `Basic ${basicAuth}` }, cache: "no-store" },
  );
  if (!authorizationResponse.ok) {
    throw new Error(`B2 account authorization failed (HTTP ${authorizationResponse.status}).`);
  }

  const authorization = (await authorizationResponse.json()) as B2Authorization;
  const s3ApiUrl = authorization.apiInfo?.storageApi?.s3ApiUrl;
  if (!s3ApiUrl) {
    throw new Error("B2 did not return an S3-compatible endpoint.");
  }

  const endpoint = new URL(s3ApiUrl);
  const region = endpoint.hostname.split(".")[1];
  if (!region) {
    throw new Error("B2 returned an invalid S3-compatible endpoint.");
  }

  const client = new S3Client({
    endpoint: endpoint.origin,
    region,
    forcePathStyle: true,
    maxAttempts: 3,
    credentials: {
      accessKeyId: applicationKeyId,
      secretAccessKey: applicationKey,
    },
  });

  const configuredBucketName = environment.B2_BUCKET_NAME?.trim();
  const restrictedBucketName = authorization.allowed?.bucketName?.trim() || undefined;
  if (
    configuredBucketName &&
    restrictedBucketName &&
    configuredBucketName !== restrictedBucketName
  ) {
    throw new Error("B2_BUCKET_NAME does not match the bucket allowed by this application key.");
  }

  let bucketName = configuredBucketName || restrictedBucketName;
  if (!bucketName) {
    const bucketListing = await client.send(new ListBucketsCommand({}));
    const bucketNames = (bucketListing.Buckets ?? [])
      .map((bucket) => bucket.Name)
      .filter((name): name is string => Boolean(name));

    if (bucketNames.length === 0) {
      throw new Error("No B2 bucket is available to this application key.");
    }
    if (bucketNames.length > 1) {
      throw new Error("Set B2_BUCKET_NAME to choose which B2 bucket stores customer files.");
    }
    [bucketName] = bucketNames;
  }

  return {
    client,
    bucketName,
    bucketMarker: `b2:${bucketName}`,
  };
}

export async function getB2Target(
  environment: B2StorageEnvironment = process.env,
): Promise<B2Target> {
  if (!targetPromise) {
    targetPromise = initializeTarget(environment).catch((error: unknown) => {
      targetPromise = undefined;
      throw error;
    });
  }
  return targetPromise;
}

export async function uploadB2Object(options: {
  key: string;
  body: Readable;
  contentType: string;
  contentLength?: number;
}, environment: B2StorageEnvironment = process.env): Promise<{ bucketMarker: string; sizeBytes: number; mimeType: string }> {
  const target = await getB2Target(environment);
  const upload = new Upload({
    client: target.client,
    params: {
      Bucket: target.bucketName,
      Key: options.key,
      Body: options.body,
      ContentType: options.contentType,
      ...(options.contentLength === undefined ? {} : { ContentLength: options.contentLength }),
    },
    queueSize: 2,
    partSize: 16 * 1024 * 1024,
    leavePartsOnError: false,
  });

  await upload.done();

  try {
    const head = await target.client.send(
      new HeadObjectCommand({
        Bucket: target.bucketName,
        Key: options.key,
      }),
    );
    const sizeBytes = head.ContentLength;
    if (sizeBytes === undefined || !Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
      throw new Error("B2 did not return a valid object size after upload.");
    }
    if (options.contentLength !== undefined && sizeBytes !== options.contentLength) {
      throw new Error("The uploaded B2 object size did not match the request.");
    }

    return {
      bucketMarker: target.bucketMarker,
      sizeBytes,
      mimeType: head.ContentType || options.contentType,
    };
  } catch (verificationError) {
    try {
      await deleteB2Object(options.key, environment);
    } catch (cleanupError) {
      throw new AggregateError(
        [verificationError, cleanupError],
        "B2 upload verification failed and the object could not be cleaned up.",
      );
    }
    throw verificationError;
  }
}

export async function getB2Object(options: {
  key: string;
  range?: string;
}, environment: B2StorageEnvironment = process.env) {
  const target = await getB2Target(environment);
  return target.client.send(
    new GetObjectCommand({
      Bucket: target.bucketName,
      Key: options.key,
      ...(options.range ? { Range: options.range } : {}),
    }),
  );
}

export async function deleteB2Object(
  key: string,
  environment: B2StorageEnvironment = process.env,
): Promise<void> {
  const target = await getB2Target(environment);
  let keyMarker: string | undefined;
  let versionIdMarker: string | undefined;

  while (true) {
    const page = await target.client.send(
      new ListObjectVersionsCommand({
        Bucket: target.bucketName,
        Prefix: key,
        ...(keyMarker ? { KeyMarker: keyMarker } : {}),
        ...(versionIdMarker ? { VersionIdMarker: versionIdMarker } : {}),
      }),
    );

    const objectVersions = [
      ...(page.Versions ?? []),
      ...(page.DeleteMarkers ?? []),
    ].filter((entry) => entry.Key === key && typeof entry.VersionId === "string");

    if (objectVersions.length > 0) {
      const deletion = await target.client.send(
        new DeleteObjectsCommand({
          Bucket: target.bucketName,
          Delete: {
            Objects: objectVersions.map((entry) => ({
              Key: key,
              VersionId: entry.VersionId,
            })),
            Quiet: false,
          },
        }),
      );
      if (deletion.Errors?.length) {
        throw new Error(
          `B2 could not permanently delete ${deletion.Errors.length} object version(s).`,
        );
      }
    }

    if (!page.IsTruncated) return;

    const nextKeyMarker = page.NextKeyMarker;
    const nextVersionIdMarker = page.NextVersionIdMarker;
    if (
      !nextKeyMarker ||
      (nextKeyMarker === keyMarker && nextVersionIdMarker === versionIdMarker)
    ) {
      throw new Error("B2 returned an invalid object-version pagination marker.");
    }
    keyMarker = nextKeyMarker;
    versionIdMarker = nextVersionIdMarker;
  }
}

function attachmentDisposition(fileName: string): string {
  const safeName = fileName.replace(/[\r\n]/g, "").slice(0, 255) || "download";
  const fallback = safeName.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(safeName).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export async function createB2SignedUrl(options: {
  key: string;
  expiresIn: number;
  downloadName?: string;
}, environment: B2StorageEnvironment = process.env): Promise<string> {
  const target = await getB2Target(environment);
  const command = new GetObjectCommand({
    Bucket: target.bucketName,
    Key: options.key,
    ...(options.downloadName
      ? { ResponseContentDisposition: attachmentDisposition(options.downloadName) }
      : {}),
  });
  return getSignedUrl(target.client, command, { expiresIn: options.expiresIn });
}

export async function inspectB2Video(
  key: string,
  fileId: string,
  environment: B2StorageEnvironment = process.env,
): Promise<B2VideoInspection> {
  const target = await getB2Target(environment);
  const [head, rangeResult] = await Promise.all([
    target.client.send(
      new HeadObjectCommand({
        Bucket: target.bucketName,
        Key: key,
      }),
    ),
    target.client.send(
      new GetObjectCommand({
        Bucket: target.bucketName,
        Key: key,
        Range: "bytes=0-262143",
      }),
    ),
  ]);

  const chunks: Buffer[] = [];
  if (rangeResult.Body) {
    for await (const chunk of rangeResult.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
  }
  const header = Buffer.concat(chunks);
  const atoms: Record<string, unknown> = {};
  let offset = 0;
  let moovFound = false;
  let mdatFound = false;

  while (offset < header.length - 8) {
    const size = header.readUInt32BE(offset);
    const type = header.toString("ascii", offset + 4, offset + 8);

    if (size < 8 || offset + size > header.length) {
      atoms[type] = { offset, size, truncated: true };
      break;
    }

    if (type === "ftyp" && offset + 12 <= header.length) {
      atoms.ftyp = { brand: header.toString("ascii", offset + 8, offset + 12), offset };
    } else if (type === "moov") {
      moovFound = true;
      atoms.moov = { offset, size };
    } else if (type === "mdat") {
      mdatFound = true;
      atoms.mdat = { offset, size };
      break;
    } else {
      atoms[type] = { offset, size };
    }

    offset += size;
  }

  const codec: Record<string, string> = {};
  const headerText = new TextDecoder().decode(header);
  for (const candidate of ["avc1", "hvc1", "hev1", "mp4a", "av01", "vp09", "vp08", "ac-3", "ec-3", "AAC"]) {
    if (headerText.includes(candidate)) {
      codec.found = candidate;
      break;
    }
  }

  const moovOffset = (atoms.moov as { offset?: number } | undefined)?.offset;
  const mdatOffset = (atoms.mdat as { offset?: number } | undefined)?.offset;

  return {
    fileId,
    fileName: key.slice(key.lastIndexOf("/") + 1),
    mimeType: head.ContentType || "application/octet-stream",
    size: head.ContentLength ?? 0,
    codec,
    moovBeforeMdat: moovFound && (!mdatFound || (moovOffset !== undefined && mdatOffset !== undefined && moovOffset < mdatOffset)),
    moovFound,
    mdatFound,
    atoms,
    headerBytesRead: header.length,
  };
}
