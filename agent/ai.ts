import "dotenv/config";
import { type Model } from "@earendil-works/pi-ai";

const apiKey = process.env.OPENAI_API_KEY || "";
const baseUrl = process.env.OPENAI_BASE_URL || "";

export { apiKey, baseUrl };

export const inaiModel: Model<"openai-completions"> = {
  id: "deepseek-v4-flash",
  name: "Deepseek V4 Flash",
  api: "openai-completions",
  provider: "inai-provider",           // 必须与 Provider.id 一致
  baseUrl,
  reasoning: false,
  input: ["text"],
  contextWindow: 128000,
  maxTokens: 4096,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  },
};
