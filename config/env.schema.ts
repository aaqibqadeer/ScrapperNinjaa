/**
 * config/env.schema.ts — CORE (CLAUDE.md §2, §4).
 *
 * The single validated gateway to environment variables. Application code never
 * reads `process.env.X` directly — it imports `env` from here.
 *
 * Validation is CONDITIONAL: a provider's secret is only required when the thing
 * that uses it is active. Feature secrets are gated by their flag (enabling
 * `payments` requires `STRIPE_SECRET_KEY`). On a missing required var the app
 * throws at boot with a message listing exactly which vars are missing and why.
 *
 * `DB_PROVIDER` is CORE (§2) and always required — the database is not optional.
 * This fork resolved it to MongoDB (§1.5); the Supabase adapter was removed.
 */

import { z } from "zod";
import { features, isAnyAuthEnabled } from "./features";
import { PRODUCT_IDS } from "./products";

/** Coerce common truthy strings ("1", "true", "yes") to a boolean. */
const booleanFromString = z
  .string()
  .optional()
  .transform(
    (v) =>
      v === "1" || v?.toLowerCase() === "true" || v?.toLowerCase() === "yes",
  );

const optionalString = z.string().min(1).optional();

/**
 * All env vars the app may read. Everything provider-specific is optional here;
 * whether it is *required* is decided by the flag-aware refinement below, so we
 * can produce a precise "missing X because flag Y is on" error.
 */
const baseSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  TEST_MODE: booleanFromString,
  /**
   * Regex (case-insensitive) the DB target must match when TEST_MODE is on.
   * Defaults to "test" so an isolated `*-test*` instance passes the guardrail.
   */
  TEST_DB_PATTERN: z.string().min(1).default("test"),

  // App base URL — used to build OAuth redirect URIs and email links.
  NEXT_PUBLIC_APP_URL: z.string().min(1).default("http://localhost:3000"),
  /**
   * Which product this deployment is (identity: name, marketing copy, legal).
   * Always required — independent of feature flags. Valid: scrapperninja.
   */
  NEXT_PUBLIC_PRODUCT: z.enum(PRODUCT_IDS),
  // From-address for transactional auth emails (magic link / reset) sent via
  // Resend in the custom (MongoDB) flow. Optional; defaults to Resend's sandbox.
  AUTH_EMAIL_FROM: optionalString,

  // Database — CORE. This fork is MongoDB-only (§1.5).
  DB_PROVIDER: z.enum(["mongodb"]),
  MONGODB_URI: optionalString,

  // Auth
  AUTH_SECRET: optionalString,
  // Email of the user to promote to platform super-admin during seeding (§14).
  // Optional — it unlocks no secret, so there is no required-when rule for it.
  SUPER_ADMIN_EMAIL: optionalString,
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  GITHUB_CLIENT_ID: optionalString,
  GITHUB_CLIENT_SECRET: optionalString,
  LINKEDIN_CLIENT_ID: optionalString,
  LINKEDIN_CLIENT_SECRET: optionalString,

  // Field-level encryption key for sensitive data at rest — base64-encoded 32 bytes
  // (`openssl rand -base64 32`). Losing it makes encrypted data unrecoverable.
  EEO_ENCRYPTION_KEY: optionalString,

  // Email (used by magic-link delivery)
  RESEND_API_KEY: optionalString,

  // Payments
  STRIPE_SECRET_KEY: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: optionalString,

  // Storage (S3 / S3-compatible)
  STORAGE_PROVIDER: optionalString,
  AWS_S3_BUCKET: optionalString,
  AWS_REGION: optionalString,
  AWS_ACCESS_KEY_ID: optionalString,
  AWS_SECRET_ACCESS_KEY: optionalString,
  // Optional custom endpoint for S3-compatible providers (R2, MinIO). No rule.
  AWS_S3_ENDPOINT: optionalString,

  // Phone verification (Twilio Verify)
  TWILIO_ACCOUNT_SID: optionalString,
  TWILIO_AUTH_TOKEN: optionalString,
  TWILIO_VERIFY_SERVICE_SID: optionalString,

  // AI providers
  ANTHROPIC_API_KEY: optionalString,
  OPENAI_API_KEY: optionalString,
  DEEPSEEK_API_KEY: optionalString,
  /**
   * Google PageSpeed Insights API key (ScrapperNinja enrichment, Phase 3).
   * OPTIONAL and gated by NO flag: an absent key simply leaves the pageSpeed
   * fields blank and must never fail env validation or a job. Never add a
   * required-when rule for it.
   */
  PAGESPEED_API_KEY: optionalString,
  // Optional preferred default provider when several are enabled. Unlocks no
  // secret, so it has no required-when rule; falls back to the first enabled.
  AI_DEFAULT_PROVIDER: z.enum(["anthropic", "openai", "deepseek"]).optional(),
});

type BaseEnv = z.infer<typeof baseSchema>;

/**
 * One required-when-on rule. `when` is the flag condition; `key` is the env var
 * that must then be present; `reason` explains it in the error message.
 */
interface RequirementRule {
  when: boolean;
  key: keyof BaseEnv;
  reason: string;
}

function requirementRules(value: BaseEnv): RequirementRule[] {
  return [
    // Database (gated by DB_PROVIDER)
    {
      when: value.DB_PROVIDER === "mongodb",
      key: "MONGODB_URI",
      reason: "DB_PROVIDER is 'mongodb'",
    },

    // Auth
    {
      when: isAnyAuthEnabled,
      key: "AUTH_SECRET",
      reason: "an auth method is enabled",
    },
    {
      when: features.auth.oauth.google,
      key: "GOOGLE_CLIENT_ID",
      reason: "auth.oauth.google is on",
    },
    {
      when: features.auth.oauth.google,
      key: "GOOGLE_CLIENT_SECRET",
      reason: "auth.oauth.google is on",
    },
    {
      when: features.auth.oauth.github,
      key: "GITHUB_CLIENT_ID",
      reason: "auth.oauth.github is on",
    },
    {
      when: features.auth.oauth.github,
      key: "GITHUB_CLIENT_SECRET",
      reason: "auth.oauth.github is on",
    },
    {
      when: features.auth.oauth.linkedin,
      key: "LINKEDIN_CLIENT_ID",
      reason: "auth.oauth.linkedin is on",
    },
    {
      when: features.auth.oauth.linkedin,
      key: "LINKEDIN_CLIENT_SECRET",
      reason: "auth.oauth.linkedin is on",
    },
    // Magic link is the ONLY way in for that method, so the key is mandatory.
    // Email+password deliberately does NOT require it: verification/reset
    // links fall back to the server console (lib/email/send.ts), which is how
    // local testing works without an email provider.
    {
      when: features.auth.magicLink,
      key: "RESEND_API_KEY",
      reason: "auth.magicLink is on (email delivery)",
    },

    // Field-level encryption — required whenever any auth method is on.
    {
      when: isAnyAuthEnabled,
      key: "EEO_ENCRYPTION_KEY",
      reason: "an auth method is enabled (field-level encryption)",
    },

    // Payments (annualBilling is a UI/data cadence flag — unlocks no new secret)
    {
      when: features.payments.enabled,
      key: "STRIPE_SECRET_KEY",
      reason: "payments is on",
    },
    {
      when: features.payments.enabled,
      key: "STRIPE_WEBHOOK_SECRET",
      reason: "payments is on",
    },
    {
      when: features.payments.enabled,
      key: "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
      reason: "payments is on",
    },

    // Storage
    {
      when: features.storage,
      key: "STORAGE_PROVIDER",
      reason: "storage is on",
    },
    // S3 credentials — required when storage uses the S3 provider.
    {
      when: features.storage && value.STORAGE_PROVIDER === "s3",
      key: "AWS_S3_BUCKET",
      reason: "storage is on with STORAGE_PROVIDER=s3",
    },
    {
      when: features.storage && value.STORAGE_PROVIDER === "s3",
      key: "AWS_REGION",
      reason: "storage is on with STORAGE_PROVIDER=s3",
    },
    {
      when: features.storage && value.STORAGE_PROVIDER === "s3",
      key: "AWS_ACCESS_KEY_ID",
      reason: "storage is on with STORAGE_PROVIDER=s3",
    },
    {
      when: features.storage && value.STORAGE_PROVIDER === "s3",
      key: "AWS_SECRET_ACCESS_KEY",
      reason: "storage is on with STORAGE_PROVIDER=s3",
    },

    // Phone verification
    {
      when: features.phoneVerification,
      key: "TWILIO_ACCOUNT_SID",
      reason: "phoneVerification is on",
    },
    {
      when: features.phoneVerification,
      key: "TWILIO_AUTH_TOKEN",
      reason: "phoneVerification is on",
    },
    {
      when: features.phoneVerification,
      key: "TWILIO_VERIFY_SERVICE_SID",
      reason: "phoneVerification is on",
    },

    // AI providers
    {
      when: features.aiProviders.includes("anthropic"),
      key: "ANTHROPIC_API_KEY",
      reason: "aiProviders includes 'anthropic'",
    },
    {
      when: features.aiProviders.includes("openai"),
      key: "OPENAI_API_KEY",
      reason: "aiProviders includes 'openai'",
    },
    {
      when: features.aiProviders.includes("deepseek"),
      key: "DEEPSEEK_API_KEY",
      reason: "aiProviders includes 'deepseek'",
    },
  ];
}

const envSchema = baseSchema.superRefine((value, ctx) => {
  for (const rule of requirementRules(value)) {
    if (rule.when && !value[rule.key]) {
      ctx.addIssue({
        code: "custom",
        path: [rule.key],
        message: `required — ${rule.reason}`,
      });
    }
  }
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (result.success) return result.data;

  // Escape hatch for builds / type generation / CI without real secrets
  // (the pattern used by t3-env). Never set this at runtime.
  if (process.env.SKIP_ENV_VALIDATION) {
    const partial = baseSchema.partial().safeParse(process.env);
    return {
      ...(partial.success ? partial.data : {}),
      NODE_ENV: (process.env.NODE_ENV as Env["NODE_ENV"]) ?? "development",
      TEST_MODE: false,
      TEST_DB_PATTERN: process.env.TEST_DB_PATTERN ?? "test",
      NEXT_PUBLIC_APP_URL:
        process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
      DB_PROVIDER:
        (process.env.DB_PROVIDER as Env["DB_PROVIDER"]) ?? "mongodb",
    } as Env;
  }

  const details = result.error.issues
    .map((issue) => {
      const varName = issue.path.length ? issue.path.join(".") : "(root)";
      return `  - ${varName}: ${issue.message}`;
    })
    .join("\n");
  throw new Error(
    `Invalid environment configuration — fix the following and restart:\n${details}\n\n` +
      `See .env.example for every variable and which feature flag requires it.\n` +
      `(Set SKIP_ENV_VALIDATION=1 to bypass this for builds/CI without secrets.)`,
  );
}

export const env: Env = parseEnv();

/**
 * Test-environment guardrail (CLAUDE.md §12).
 *
 * When TEST_MODE is on, the resolved database target (Mongo URI) must match
 * `TEST_DB_PATTERN` (default: /test/i). If it doesn't, refuse to start — a
 * deliberate speed bump against pointing a destructive test/seed run at a
 * non-test database. Tune the allow-list per fork via `TEST_DB_PATTERN`
 * (e.g. a `-test` Mongo cluster suffix).
 */
export function assertTestEnvironmentSafety(): void {
  if (!env.TEST_MODE) return;

  const target = env.MONGODB_URI ?? "";
  const matchesTestPattern = new RegExp(env.TEST_DB_PATTERN, "i").test(target);

  if (!matchesTestPattern) {
    throw new Error(
      `TEST_MODE is on, but the configured ${env.DB_PROVIDER} database target ` +
        `does not match the test allow-list pattern /${env.TEST_DB_PATTERN}/i. ` +
        `Refusing to start to avoid touching a non-test database. Point it at an ` +
        `isolated test instance, or adjust TEST_DB_PATTERN.`,
    );
  }
}

assertTestEnvironmentSafety();
