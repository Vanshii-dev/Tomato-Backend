import dotenv from "dotenv"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env")
const { error } = dotenv.config({ path: envPath })

if (error && error.code !== "ENOENT") {
  throw error
}
