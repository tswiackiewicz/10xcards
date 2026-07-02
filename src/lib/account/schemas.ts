/** Typed error codes returned by the account + cron endpoints, mirroring the
 *  `ApiErrorCode` pattern used by the flashcards endpoints (src/lib/flashcards/schemas.ts). */
export type AccountErrorCode = "unauthorized" | "server_error" | "service_unavailable" | "purge_failed";
