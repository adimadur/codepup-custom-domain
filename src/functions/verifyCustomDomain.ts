import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { sql } from "../db/neon";

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

    const isApex = domain.split(".").length === 2;
    const routingType = isApex ? "A" : "CNAME";

    // -------------------------------------------------
    // STEP 1 — TXT Ownership Verification
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
          message: "TXT record missing. Ownership not verified.",
          requiredRecords: [
            {
              type: "TXT",
              host: txtData.error.record.name,
              value: txtData.error.record.value,
              ttl: 60
            }
          ]
        }
      };
    }

    const txtVerified = txtRes.ok === true;

    // -------------------------------------------------
    // STEP 2 — Routing Verification (A / CNAME)
    // -------------------------------------------------
    const configUrl = `https://api.vercel.com/v6/domains/${domain}/config`;

    const configRes = await fetch(configUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const configData = await configRes.json();
    const routingVerified = configData?.misconfigured === false;
    const fullyVerified = txtVerified && routingVerified;

    // -------------------------------------------------
    // STEP 3 — UPDATE DATABASE STATE
    // -------------------------------------------------
    await sql`
      UPDATE custom_domains
      SET
        txt_verified = ${txtVerified},
        routing_type = ${routingType},
        routing_verified = ${routingVerified},
        fully_verified = ${fullyVerified},
        last_config_response = ${JSON.stringify(configData)},
        updated_at = now()
      WHERE project_id = ${projectId};
    `;

    // -------------------------------------------------
    // STEP 4 — RESPONSE
    // -------------------------------------------------
    return {
      status: 200,
      jsonBody: {
        success: true,
        domain,
        projectId,
        status: {
          txtVerified,
          routingVerified,
          fullyVerified
        }
      }
    };

  } catch (err: any) {
    context.log("verifyCustomDomain error", err);
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
