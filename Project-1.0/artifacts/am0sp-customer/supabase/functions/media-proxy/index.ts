import { createClient } from "npm:@supabase/supabase-js@2.57.4";

// H2: Explicit origin allowlist — never use wildcard CORS.
const APP_ORIGIN = Deno.env.get("APP_ORIGIN");
if (!APP_ORIGIN) throw new Error("Missing required Edge Function secret: APP_ORIGIN");
const ALLOWED_ORIGINS = [APP_ORIGIN];

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required Edge Function secret: ${name}`);
  return value;
}

function corsHeaders(origin: string) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, Range",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, Content-Disposition, Content-Type, X-File-Name, X-File-Mime, X-Diagnostic",
    "Vary": "Origin",
  };
}

const BUCKET = "am0sp-vault";

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") ?? ALLOWED_ORIGINS[0];
  const ch = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: ch });
  }

  try {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/media-proxy\/?/, "");
    const parts = path.split("/").filter(Boolean);

    const action = parts[0];
    const fileId = parts[1];

    if (!action || !fileId) {
      return new Response(JSON.stringify({ error: "Missing action or fileId" }), {
        status: 400,
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const authHeader = req.headers.get("Authorization") || "";
    const anonKey = req.headers.get("apikey") || "";

    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }

    const { data: fileRecord, error: fileError } = await supabase
      .from("files")
      .select("id, user_id, storage_key, original_name, mime_type, size_bytes, category")
      .eq("id", fileId)
      .maybeSingle();

    if (fileError || !fileRecord) {
      return new Response(JSON.stringify({ error: "File not found" }), {
        status: 404,
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }

    if (fileRecord.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "Access denied" }), {
        status: 403,
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }

    if (action === "signed") {
      // Generate a short-lived signed URL (5 minutes).
      // Do NOT pass download= here — the signed URL is used for both
      // video playback (needs inline) and large file download (client
      // uses <a download> which forces download regardless of headers).
      const { data: signData, error: signError } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(fileRecord.storage_key, 300);

      if (signError || !signData?.signedUrl) {
        return new Response(JSON.stringify({ error: "Failed to create signed URL: " + (signError?.message || "unknown") }), {
          status: 500,
          headers: { ...ch, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        signedUrl: signData.signedUrl,
        fileName: fileRecord.original_name,
        mimeType: fileRecord.mime_type,
        size: fileRecord.size_bytes,
      }), {
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }

    if (action === "inspect") {
      const { data: signData, error: signError } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(fileRecord.storage_key, 60);

      if (signError || !signData?.signedUrl) {
        return new Response(JSON.stringify({ error: "Failed to create signed URL for inspect" }), {
          status: 500,
          headers: { ...ch, "Content-Type": "application/json" },
        });
      }

      const inspectResp = await fetch(signData.signedUrl, {
        headers: { Range: "bytes=0-262143" },
      });

      if (!inspectResp.ok && inspectResp.status !== 206) {
        return new Response(JSON.stringify({ error: `Storage returned ${inspectResp.status} for inspect` }), {
          status: 500,
          headers: { ...ch, "Content-Type": "application/json" },
        });
      }

      const buf = new Uint8Array(await inspectResp.arrayBuffer());

      const atoms: Record<string, unknown> = {};
      let offset = 0;
      let moovFound = false;
      let mdatFound = false;

      while (offset < buf.length - 8) {
        const size = (buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3];
        const type = String.fromCharCode(buf[offset + 4], buf[offset + 5], buf[offset + 6], buf[offset + 7]);

        if (size < 8 || offset + size > buf.length) {
          atoms[type] = { offset, size, truncated: true };
          break;
        }

        if (type === "ftyp") {
          const brand = String.fromCharCode(buf[offset + 8], buf[offset + 9], buf[offset + 10], buf[offset + 11]);
          atoms.ftyp = { brand, offset };
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

      const codecInfo: Record<string, string> = {};
      const text = new TextDecoder().decode(buf);
      const codecs = ["avc1", "hvc1", "hev1", "mp4a", "av01", "vp09", "vp08", "ac-3", "ec-3", "AAC"];
      for (const codec of codecs) {
        const idx = text.indexOf(codec);
        if (idx >= 0) {
          codecInfo.found = codec;
          break;
        }
      }

      const streamingOptimized = moovFound && (!mdatFound || (atoms.moov && atoms.mdat && (atoms.moov as { offset: number }).offset < (atoms.mdat as { offset: number }).offset));

      return new Response(JSON.stringify({
        fileId,
        fileName: fileRecord.original_name,
        mimeType: fileRecord.mime_type,
        size: fileRecord.size_bytes,
        atoms,
        codec: codecInfo,
        moovBeforeMdat: streamingOptimized,
        moovFound,
        mdatFound,
        headerBytesRead: buf.length,
      }), {
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }

    if (action === "proxy" || action === "download") {
      const isDownload = action === "download";
      const rangeHeader = req.headers.get("Range");

      const { data: signData, error: signError } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(fileRecord.storage_key, 300);

      if (signError || !signData?.signedUrl) {
        return new Response(JSON.stringify({ error: "Failed to create signed URL" }), {
          status: 500,
          headers: { ...ch, "Content-Type": "application/json" },
        });
      }

      const fetchHeaders: Record<string, string> = {};
      if (rangeHeader) {
        fetchHeaders["Range"] = rangeHeader;
      }

      const storageResp = await fetch(signData.signedUrl, { headers: fetchHeaders });

      if (!storageResp.ok && storageResp.status !== 206) {
        return new Response(JSON.stringify({
          error: `Storage returned ${storageResp.status}`,
        }), {
          status: storageResp.status,
          headers: { ...ch, "Content-Type": "application/json" },
        });
      }

      const safeName = fileRecord.original_name.replace(/"/g, "'");
      const disposition = isDownload ? "attachment" : "inline";

      const respHeaders: Record<string, string> = {
        ...ch,
        "Content-Type": fileRecord.mime_type || "application/octet-stream",
        "Content-Disposition": `${disposition}; filename="${safeName}"`,
        "X-File-Name": encodeURIComponent(fileRecord.original_name),
        "X-File-Mime": fileRecord.mime_type || "application/octet-stream",
      };

      const contentLength = storageResp.headers.get("Content-Length");
      const contentRange = storageResp.headers.get("Content-Range");
      const acceptRanges = storageResp.headers.get("Accept-Ranges");

      if (contentLength) respHeaders["Content-Length"] = contentLength;
      if (contentRange) respHeaders["Content-Range"] = contentRange;
      respHeaders["Accept-Ranges"] = acceptRanges || "bytes";

      return new Response(storageResp.body, {
        status: storageResp.status,
        headers: respHeaders,
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action: " + action }), {
      status: 400,
      headers: { ...ch, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...ch, "Content-Type": "application/json" },
    });
  }
});
