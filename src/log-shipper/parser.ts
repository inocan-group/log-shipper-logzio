import { ICloudWatchLogEvent, IDictionary } from "common-types";

// takes an an input a hash and props to escalate
function escalateContext(hash: IDictionary, ...props: string[]) {
  const regular: IDictionary = {};
  const escalated: IDictionary = {};
  Object.keys(hash).map(key => {
    if (typeof hash[key] === "object") {
      return;
    }
    let setTo: string;
    if (key.includes(":")) {
      [key, setTo] = key.split(":");
    } else {
      setTo = key;
    }
    if (props.includes(key)) {
      regular[key] = hash[key];
    } else {
      escalated[`@${setTo}`] = hash[key];
    }
  });
  return { regular, escalated };
}

interface IIsolateOptions {
  addAsterisk?: boolean;
  /** force possible JSON string to object */
  ensureIsObject?: string[];
}

/** isolates a set of properties  */
function isolateProperties(
  hash: IDictionary,
  props: string[],
  options: IIsolateOptions = {}
) {
  const _defaults: IIsolateOptions = { addAsterisk: false, ensureIsObject: [] };
  options = { ..._defaults, ...options };
  const output: IDictionary = {};
  const keys = Object.keys(hash);
  keys.forEach(key => {
    if (props.includes(key)) {
      const asterisk = options.addAsterisk ? "@" : "";
      output[asterisk + key] = hash[key];
    }
  });
  return output;
}

// logGroup looks like this:
//    "logGroup": "/aws/lambda/service-env-funcName"
export function functionName(logGroup: string) {
  const fn = logGroup
    .split("/")
    .reverse()[0]
    .split("-")
    .pop();
  return fn;
}

// logStream looks like this:
//    "logStream": "2016/08/17/[76]afe5c000d5344c33b5d88be7a4c55816"
export function lambdaVersion(logStream: string) {
  let start = logStream.indexOf("[");
  let end = logStream.indexOf("]");
  return logStream.substring(start + 1, end);
}

let tryParseJson = function(str: string) {
  try {
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
};

function levelFromSeverity(severity: number) {
  const lookup: IDictionary = {
    1: "debug",
    2: "info",
    3: "warn",
    4: "error"
  };
  return severity > 0 && severity < 5 ? lookup[String(severity)] : "unknown";
}

// a Lambda function log message looks like this:
//    "2017-04-26T10:41:09.023Z	db95c6da-2a6c-11e7-9550-c91b65931beb\tloading index.html...\n"
// but there are START, END and REPORT messages too:
//    "START RequestId: 67c005bb-641f-11e6-b35d-6b6c651a2f01 Version: 31\n"
//    "END RequestId: 5e665f81-641f-11e6-ab0f-b1affae60d28\n"
//    "REPORT RequestId: 5e665f81-641f-11e6-ab0f-b1affae60d28\tDuration: 1095.52 ms\tBilled Duration: 1100 ms \tMemory Size: 128 MB\tMax Memory Used: 32 MB\t\n"
export function logMessage(logEvent: ICloudWatchLogEvent) {
  if (
    logEvent.message.startsWith("START RequestId") ||
    logEvent.message.startsWith("END RequestId")
  ) {
    return null;
  } else if (logEvent.message.startsWith("REPORT RequestId")) {
    const [
      all,
      requestId,
      duration,
      billedDuration,
      memorySize,
      memoryUsed
    ] = logEvent.message.match(
      /REPORT RequestId: ([0-9a-z\-]*).*Duration: ([0-9]*\.[0-9]*) ms.*Billed Duration:\s*([0-9]*) ms.*Memory Size: ([0-9]*).*Max Memory Used: ([0-9]*) MB/
    );
    return {
      message: `REPORT for ${requestId} [ ${duration}ms, billed ${billedDuration}ms ]`,
      kind: "report",
      requestId,
      durationUsed: Number(duration),
      durationBilled: Number(billedDuration),
      memSize: Number(memorySize),
      memUsed: Number(memoryUsed)
    };
  }

  const { message, timestamp } = logEvent;
  const event = message.substring(message.indexOf('{'), message.lastIndexOf('}') + 1);
  let fields = tryParseJson(event);

  if (fields) {
    let level = levelFromSeverity(fields.severity || -1);

    function removeUnwanted(hash: IDictionary, ...fields: string[]) {
      const output: IDictionary = { ...{}, ...hash };
      fields.map(f => delete output[f as keyof typeof hash]);

      return output;
    }

    const { regular, escalated } = escalateContext(
      fields,
      "correlationId:correlation-id",
      "severity",
      "region",
      "stage",
      ""
    );

    return {
      ...regular,
      ...escalated,
      ...{ payload: fields.payload || {} },
      ...{
        context: removeUnwanted(
          fields.context,
          "logGroupName",
          "logStreamName",
          "functionVersion"
        )
      },
      level,
      ...{ "@timestamp": new Date(timestamp) }
    };
  } else {
    return {
      level: "debug",
      message: event,
      "@timestamp": new Date(timestamp)
    };
  }
}
