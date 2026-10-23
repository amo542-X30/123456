import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

interface SupabaseRuntimeConfig {
  url: string;
  anonKey: string;
}

function normalizeSupabaseUrl(value: string): string | null {
  try {
    return new URL(value).toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

async function isSupabaseAuthPairAccepted(url: string, anonKey: string): Promise<boolean> {
  try {
    const response = await fetch(`${url.replace(/\/+$/, '')}/auth/v1/settings`, {
      headers: { apikey: anonKey },
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

async function getVerifiedWorkerSupabaseConfig(): Promise<SupabaseRuntimeConfig | null> {
  const localUrl = process.env.VITE_SUPABASE_URL?.trim();
  const localKey = process.env.VITE_SUPABASE_ANON_KEY?.trim();

  if (localUrl && localKey && await isSupabaseAuthPairAccepted(localUrl, localKey)) {
    return null;
  }

  const appUrl = process.env.VITE_APP_URL?.trim();
  if (!appUrl) {
    throw new Error(
      'Vite rejected its Supabase key, and VITE_APP_URL is unavailable for verified runtime configuration.',
    );
  }

  const workerResponse = await fetch(appUrl);
  if (!workerResponse.ok) {
    throw new Error(`Could not load the verified customer runtime config (HTTP ${workerResponse.status}).`);
  }

  const html = await workerResponse.text();
  const configMatch = html.match(
    /window\.__AM0SP_SUPABASE_CONFIG__\s*=\s*(\{[^;]+\})\s*;/,
  );
  if (!configMatch) {
    throw new Error('The customer runtime did not provide Supabase configuration to Vite.');
  }

  let config: SupabaseRuntimeConfig;
  try {
    config = JSON.parse(configMatch[1]) as SupabaseRuntimeConfig;
  } catch {
    throw new Error('The customer runtime provided malformed Supabase configuration.');
  }

  if (!config.url || !config.anonKey) {
    throw new Error('The customer runtime provided incomplete Supabase configuration.');
  }

  if (localUrl && normalizeSupabaseUrl(localUrl) !== normalizeSupabaseUrl(config.url)) {
    throw new Error('The Vite and customer runtime Supabase URLs do not match; refusing to switch projects.');
  }

  if (!(await isSupabaseAuthPairAccepted(config.url, config.anonKey))) {
    throw new Error('The customer runtime Supabase key was also rejected by Supabase Auth.');
  }

  return config;
}

function verifiedSupabaseRuntimeConfigPlugin() {
  let configPromise: Promise<SupabaseRuntimeConfig | null> | undefined;

  return {
    name: 'verified-supabase-runtime-config',
    apply: 'serve' as const,
    transformIndexHtml: {
      order: 'pre' as const,
      handler(html: string) {
        configPromise ??= getVerifiedWorkerSupabaseConfig();
        return configPromise.then((config) => {
          if (!config) return html;

          const serializedConfig = JSON.stringify(config).replace(/</g, '\\u003c');
          return html.replace(
            /<\/head>/i,
            `<script>window.__AM0SP_SUPABASE_CONFIG__=${serializedConfig};</script></head>`,
          );
        });
      },
    },
  };
}

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

export default defineConfig({
  base: basePath,
  plugins: [verifiedSupabaseRuntimeConfigPlugin(), react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
