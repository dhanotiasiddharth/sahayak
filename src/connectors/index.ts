import type { Connector } from "./types.js";
import { MockConnector } from "./mock/index.js";
import { TallyConnector } from "./tally/index.js";
import { SapB1Connector } from "./sapb1/index.js";

export function makeConnector(env: NodeJS.ProcessEnv): Connector {
  switch ((env.CONNECTOR ?? "mock").toLowerCase()) {
    case "tally": return new TallyConnector({ url: env.TALLY_URL!, company: env.TALLY_COMPANY!, godown: env.TALLY_GODOWN });
    case "sapb1": return new SapB1Connector({ url: env.SAPB1_URL!, companyDb: env.SAPB1_COMPANYDB!, user: env.SAPB1_USER!, password: env.SAPB1_PASSWORD! });
    default: return new MockConnector();
  }
}
export type { Connector } from "./types.js";
