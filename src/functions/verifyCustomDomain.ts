import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";

export async function verifyCustomDomain(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    if (request.method !== "POST") {
      return { status: 405, jsonBody: { error: "Use POST method." } };
    }

    const body = await request.json().catch(() => null);
    // @ts-ignore
    if (!body?.domain || !body?.projectId) {
      return {
        status: 400,
        jsonBody: { error: "Missing required fields: domain, projectId" }
      };
    }

    // @ts-ignore
    const { domain, projectId } = body;
    const token = process.env.VERCEL_TOKEN;
    if (!token) {
      return { status: 500, jsonBody: { error: "Missing VERCEL_TOKEN." } };
    }

    const isSubdomain = domain.split(".").length > 2;
    const label = isSubdomain ? domain.split(".")[0] : "@";

    // -------------------------------------------------
    // STEP 1 — Ownership Verification via TXT
    // -------------------------------------------------
    const verifyUrl = `https://api.vercel.com/v9/projects/${projectId}/domains/${domain}/verify`;

    const txtRes = await fetch(verifyUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });

    const txtData = await txtRes.json();

    if (!txtRes.ok && txtData?.error?.code === "missing_txt_record") {
      return {
        status: 400,
        jsonBody: {
          success: false,
          type: "missing-txt-record",
          message: "Ownership not verified. Add this TXT DNS record.",
          requiredRecords: [
            {
              type: "TXT",
              host: txtData.error.record.name,
              value: txtData.error.record.value,
              ttl: 60
            }
          ],
          raw: { txtVerification: txtData }
        }
      };
    }

    // -------------------------------------------------
    // STEP 2 — Fetch DNS Configuration
    // -------------------------------------------------
    const configUrl = `https://api.vercel.com/v6/domains/${domain}/config`;
    const configRes = await fetch(configUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const configData = await configRes.json();

    // -------------------------------------------------
    // STEP 3 — Build CURRENT DNS RECORDS
    // -------------------------------------------------
    const currentRecords: any[] = [];

    if (Array.isArray(configData.aValues)) {
      configData.aValues.forEach((ip: string) =>
        currentRecords.push({ type: "A", host: "@", value: ip })
      );
    }

    if (Array.isArray(configData.cnames)) {
      configData.cnames.forEach((cname: string) =>
        currentRecords.push({ type: "CNAME", host: label, value: cname })
      );
    }

    // -------------------------------------------------
    // STEP 4 — Build REQUIRED DNS RECORDS
    // -------------------------------------------------
    const requiredRecords: any[] = [];

    // For APEX DOMAIN → require A record
    if (!isSubdomain) {
      if (Array.isArray(configData.recommendedIPv4)) {
        configData.recommendedIPv4.forEach((r: any) => {
          r.value.forEach((ip: string) => {
            requiredRecords.push({
              type: "A",
              host: "@",
              value: ip,
              ttl: 60
            });
          });
        });
      }
    }

    // For SUBDOMAIN → require CNAME only
    if (isSubdomain) {
      if (Array.isArray(configData.recommendedCNAME)) {
        configData.recommendedCNAME.forEach((r: any) => {
          requiredRecords.push({
            type: "CNAME",
            host: label,
            value: r.value,
            ttl: 60
          });
        });
      }
    }

    // -------------------------------------------------
    // STEP 5 — Return Result
    // -------------------------------------------------
    return {
      status: 200,
      jsonBody: {
        success: true,
        domain,
        projectId,
        ownershipVerified: txtRes.ok,
        dnsMisconfigured: configData.misconfigured === true,
        fullyVerified: txtRes.ok && configData.misconfigured === false,
        currentRecords,
        requiredRecords,
        raw: {
          txtVerification: txtData,
          configResponse: configData
        }
      }
    };
  } catch (err: any) {
    return {
      status: 500,
      jsonBody: { error: "Internal error", message: err.message }
    };
  }
}

app.http("verifyCustomDomain", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: verifyCustomDomain
});
