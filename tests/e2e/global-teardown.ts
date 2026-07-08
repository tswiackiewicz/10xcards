import { existsSync, readFileSync } from "node:fs";
import { cleanupUser } from "../helpers/auth";
import { SEEDED_USER_PATH } from "./paths";

export default async function globalTeardown(): Promise<void> {
  if (!existsSync(SEEDED_USER_PATH)) return;
  const { id } = JSON.parse(readFileSync(SEEDED_USER_PATH, "utf-8")) as { id: string };
  await cleanupUser(id);
}
