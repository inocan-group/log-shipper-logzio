import { IServerlessAccountInfo } from "./types";

export const plugins = (config: IServerlessAccountInfo): { plugins: string[] } => {
  return {
    plugins: [
      "serverless-pseudo-parameters",
      "serverless-step-functions",
      "serverless-offline",
      "serverless-webpack"
    ]
  };
};
