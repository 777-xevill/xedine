import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// Default Cloudflare setup; add R2/KV incremental-cache overrides here only if pages start using ISR.
export default defineCloudflareConfig();
